import pg from "pg";

const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || "5432", 10),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
});

export async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    const wrapped = new Error(`DB query error: ${err.message}\nQuery: ${text}`);
    wrapped.cause = err;
    throw wrapped;
  }
}

/** Connect to the default 'postgres' db and create the target database if it doesn't exist. */
async function ensureDatabase() {
  const dbName = process.env.PGDATABASE;
  const tempPool = new pg.Pool({
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT || "5432", 10),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: "postgres",
  });
  try {
    const res = await tempPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (res.rows.length === 0) {
      await tempPool.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Created database "${dbName}"`);
    }
  } finally {
    await tempPool.end();
  }
}

export async function initDB() {
  // Create the database if it doesn't exist yet
  await ensureDatabase();

  let client;
  try {
    client = await pool.connect();
    client.release();
    console.log("PostgreSQL connected");
  } catch (err) {
    console.error("PostgreSQL connection failed:", err.message);
    process.exit(1);
  }

  // Enable pgvector extension (requires pgvector installed on the server)
  try {
    await query(`CREATE EXTENSION IF NOT EXISTS vector`);
  } catch (err) {
    console.warn("pgvector extension not available — RAG features will use full JD fallback:", err.message);
  }

  // Interviews table (replaces the old settings table)
  await query(`
    CREATE TABLE IF NOT EXISTS interviews (
      id              UUID PRIMARY KEY,
      title           TEXT NOT NULL,
      jd              TEXT NOT NULL DEFAULT '',
      pass_threshold  REAL NOT NULL DEFAULT 60,
      domain_filter   TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'active',
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Candidates table — scoped per interview
  // If the table already exists (from old schema), migrations below will add missing columns.
  await query(`
    CREATE TABLE IF NOT EXISTS candidates (
      thread_id       TEXT PRIMARY KEY,
      interview_id    UUID REFERENCES interviews(id) ON DELETE CASCADE,
      email           TEXT NOT NULL,
      resume_hash     TEXT NOT NULL,
      resume_score    REAL,
      summary         TEXT,
      video_path      TEXT,
      english_score   REAL,
      skills          JSONB,
      status          TEXT NOT NULL DEFAULT 'Screening',
      rejection_sent  BOOLEAN NOT NULL DEFAULT FALSE,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Migrations for existing databases
  await query(`
    DO $$ BEGIN
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS interview_id UUID REFERENCES interviews(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$
  `);
  await query(`
    DO $$ BEGIN
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS rejection_sent BOOLEAN DEFAULT FALSE;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$
  `);
  await query(`
    DO $$ BEGIN
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS summary TEXT;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$
  `);

  // Indexes (safe now that columns exist)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_candidates_interview ON candidates(interview_id)
  `);

  // Global app settings (key-value)
  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Seed defaults if not present
  await query(`
    INSERT INTO settings (key, value) VALUES ('embedding_provider', 'ollama')
    ON CONFLICT (key) DO NOTHING
  `);
  await query(`
    INSERT INTO settings (key, value) VALUES ('ollama_base_url', 'http://localhost:11434')
    ON CONFLICT (key) DO NOTHING
  `);

  // JD chunks for RAG — scoped per interview (requires pgvector)
  try {
    // Migration: if jd_chunks exists with a fixed-dimension vector column, recreate it
    const colCheck = await query(`
      SELECT format_type(atttypid, atttypmod) AS col_type
      FROM pg_attribute
      WHERE attrelid = 'jd_chunks'::regclass AND attname = 'embedding'
    `).catch(() => null);
    if (colCheck && colCheck.rows.length && colCheck.rows[0].col_type !== 'vector') {
      console.log(`Migrating jd_chunks.embedding from ${colCheck.rows[0].col_type} → vector (flexible dimension)`);
      await query('DROP TABLE jd_chunks');
    }

    await query(`
      CREATE TABLE IF NOT EXISTS jd_chunks (
        id            SERIAL PRIMARY KEY,
        interview_id  UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
        chunk_text    TEXT NOT NULL,
        embedding     vector NOT NULL
      )
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_jd_chunks_interview ON jd_chunks(interview_id)
    `);
  } catch (err) {
    console.warn("Could not create jd_chunks table (pgvector may not be installed):", err.message);
  }

  console.log("Database schema initialized");
}

export default pool;

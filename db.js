import pg from "pg";

const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || "5432", 10),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
});

/**
 * Execute a parameterized query against the pool.
 * Rethrows with additional context on failure.
 */
export async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    const wrapped = new Error(`DB query error: ${err.message}\nQuery: ${text}`);
    wrapped.cause = err;
    throw wrapped;
  }
}

/**
 * Verify connection, create tables, seed default settings.
 * Exits the process if the database is unreachable.
 */
export async function initDB() {
  let client;
  try {
    client = await pool.connect();
    client.release();
    console.log("PostgreSQL connected");
  } catch (err) {
    console.error("PostgreSQL connection failed:", err.message);
    process.exit(1);
  }

  await query(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await query(`
    INSERT INTO settings (key, value) VALUES
      ('jd',            'Paste your Job Description here'),
      ('domainFilter',  '@career\\.com'),
      ('passThreshold', '60')
    ON CONFLICT (key) DO NOTHING
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS candidates (
      thread_id     TEXT PRIMARY KEY,
      email         TEXT NOT NULL,
      resume_hash   TEXT UNIQUE NOT NULL,
      resume_score  REAL,
      summary       TEXT,
      video_path    TEXT,
      english_score REAL,
      skills        JSONB,
      status        TEXT NOT NULL DEFAULT 'Screening',
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Add summary column if missing (for existing databases)
  await query(`
    DO $$ BEGIN
      ALTER TABLE candidates ADD COLUMN IF NOT EXISTS summary TEXT;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END $$
  `);

  console.log("Database schema initialized");
}

export default pool;

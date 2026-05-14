/**
 * MCP tool definitions in Groq / OpenAI function-calling format.
 * The agent-dispatcher sends these to the LLM so it can decide
 * which tool to invoke based on a natural-language prompt.
 */

export const TOOL_DEFINITIONS = [
  // ── Resume Server ────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "analyze_resume_only",
      description:
        "Extract text from a base64-encoded resume (PDF, DOCX, or DOC), embed it with " +
        "Ollama, run a pgvector cosine search against the job description chunks, then " +
        "call Groq LLM to produce a score 0-100, matched skills, missing skills, and a " +
        "summary. Updates the candidate row in the database. Use this when a candidate's " +
        "resume needs to be screened and scored for a specific interview position.",
      parameters: {
        type: "object",
        properties: {
          threadId: {
            type: "string",
            description: "Candidate thread ID (UUID) — must already exist in candidates table",
          },
          interviewId: {
            type: "string",
            description: "Interview ID (UUID) to score the resume against",
          },
          resumeBase64: {
            type: "string",
            description: "Base64-encoded resume file buffer (PDF / DOCX / DOC)",
          },
        },
        required: ["threadId", "interviewId", "resumeBase64"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "send_invite",
      description:
        "Generate secure login credentials (random token + bcrypt-hashed password) for a " +
        "candidate who passed the resume score threshold, save them to the database, and " +
        "send an invitation email containing the video-upload link and temporary password. " +
        "Sets candidate status to AwaitingVideo. Use this immediately after a resume score " +
        "meets or exceeds the interview pass threshold.",
      parameters: {
        type: "object",
        properties: {
          threadId: {
            type: "string",
            description: "Candidate thread ID (UUID)",
          },
          candidateEmail: {
            type: "string",
            description: "Candidate's email address — invitation will be sent here",
          },
        },
        required: ["threadId", "candidateEmail"],
      },
    },
  },

  // ── Scheduling Server ────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "schedule_candidate",
      description:
        "Find the next best available interviewer slot for a candidate, create a " +
        "pending scheduled_interviews row, mark the slot as booked, and email the " +
        "candidate with slot options to confirm. Uses Groq LLM to rank slots by " +
        "time variety and business-hours preference. Use this when a candidate has " +
        "passed all screening but you want them to choose their own interview slot.",
      parameters: {
        type: "object",
        properties: {
          candidateId: {
            type: "string",
            description: "Candidate thread ID (UUID)",
          },
          interviewId: {
            type: "string",
            description: "Interview ID (UUID)",
          },
        },
        required: ["candidateId", "interviewId"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "auto_assign_and_confirm_candidate",
      description:
        "Fully automated end-to-end scheduling: AI-scores available interviewers " +
        "against the job description and candidate skills, checks the HR threshold gate " +
        "(routes to HR manual review when best match score is below 40%), auto-confirms " +
        "the best slot without candidate input, and sends confirmation emails with a " +
        "Google Meet link to both the candidate and interviewer. Also triggers a calendar " +
        "event via MCP. Use this immediately after a candidate status becomes Done " +
        "following successful video analysis.",
      parameters: {
        type: "object",
        properties: {
          candidateId: {
            type: "string",
            description: "Candidate thread ID (UUID)",
          },
          interviewId: {
            type: "string",
            description: "Interview ID (UUID)",
          },
        },
        required: ["candidateId", "interviewId"],
      },
    },
  },

  // ── Candidate Server ─────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "candidate_lookup",
      description:
        "Retrieve a candidate's full profile from the database including status, scores, " +
        "skills, video summary, and scheduling information. Use this when you need to " +
        "inspect or verify a candidate's current state before taking an action.",
      parameters: {
        type: "object",
        properties: {
          threadId: {
            type: "string",
            description: "Candidate thread ID (UUID)",
          },
          email: {
            type: "string",
            description: "Candidate email (alternative lookup key)",
          },
        },
      },
    },
  },

  {
    type: "function",
    function: {
      name: "candidate_benchmarks",
      description:
        "Return aggregate score statistics (average, min, max, percentile bands) for " +
        "all candidates in a given interview. Use this to understand how a specific " +
        "candidate compares to others who applied for the same position.",
      parameters: {
        type: "object",
        properties: {
          interviewId: {
            type: "string",
            description: "Interview ID (UUID) to compute benchmarks for",
          },
        },
        required: ["interviewId"],
      },
    },
  },

  // ── HR Server ────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "list_hr_assignment_requests",
      description:
        "List all interviewer assignment requests that are pending HR manual approval. " +
        "These are cases where the AI interviewer-match score fell below the 40% threshold " +
        "and automatic scheduling was blocked. Returns request ID, candidate info, " +
        "suggested interviewers with AI scores, and the reason for HR escalation.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },

  {
    type: "function",
    function: {
      name: "approve_hr_assignment_request",
      description:
        "HR approves a specific interviewer from the suggested list for a pending " +
        "assignment request. Books the interviewer's next available slot, updates the " +
        "request status to approved, and emails the candidate their slot options.",
      parameters: {
        type: "object",
        properties: {
          requestId: {
            type: "string",
            description: "Assignment request ID (UUID)",
          },
          interviewerId: {
            type: "string",
            description: "Interviewer ID (UUID) to approve from the suggested list",
          },
          notes: {
            type: "string",
            description: "Optional HR approval notes",
          },
        },
        required: ["requestId", "interviewerId"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "reject_hr_assignment_request",
      description:
        "HR rejects a pending interviewer assignment request without booking anyone. " +
        "Sets request status to rejected. No scheduling or emails are sent to the candidate.",
      parameters: {
        type: "object",
        properties: {
          requestId: {
            type: "string",
            description: "Assignment request ID (UUID)",
          },
          notes: {
            type: "string",
            description: "Reason for rejection",
          },
        },
        required: ["requestId"],
      },
    },
  },
];

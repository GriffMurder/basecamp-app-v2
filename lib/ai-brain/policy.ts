/**
 * Embedded policy configuration — mirrors ai_brain/policy.yml.
 * This is the source of truth for routing, SLA, milestones, and templates.
 */

export interface SkillBucket {
  keywords: string[];
}

export interface Policy {
  routing: {
    skill_buckets: Record<string, SkillBucket>;
    roles: Record<string, string>;
    fallback_bucket: string;
  };
  sla_and_followup: {
    urgency_keywords: string[];
    default_priority: string;
  };
  milestones: {
    framework: Array<{ name: string; definition_of_done: string }>;
  };
  automation: {
    escalation_rules: {
      urgent_and_blocked: boolean;
      due_soon_hours: number;
    };
  };
  templates: {
    client_clarifying_questions: { max_questions: number };
  };
}

export const POLICY: Policy = {
  routing: {
    skill_buckets: {
      admin:         { keywords: ["calendar","scheduling","inbox","email","data entry","research","travel","crm"] },
      bookkeeping:   { keywords: ["quickbooks","reconcile","p&l","invoice","receipt","accounts payable","accounts receivable"] },
      social_posts:  { keywords: ["facebook","instagram","tiktok","post","caption","content calendar","hashtag"] },
      video_editing: { keywords: ["video","reel","short","edit","capcut","premiere","subtitle","caption","thumbnail"] },
      sales:         { keywords: ["lead","pipeline","follow up","crm","proposal","quote","cold","outreach","renewal"] },
      web:           { keywords: ["wordpress","website","landing page","plugin","seo","domain","hosting"] },
      design:        { keywords: ["logo","brand","flyer","poster","canva","ad creative","banner","graphic"] },
    },
    roles: {
      admin:         "Admin VA",
      bookkeeping:   "Bookkeeping VA",
      social_posts:  "Social Media VA",
      video_editing: "Video Editing VA",
      sales:         "Sales VA",
      web:           "Web VA",
      design:        "Design VA",
    },
    fallback_bucket: "admin",
  },
  sla_and_followup: {
    urgency_keywords: ["urgent","asap","today","tomorrow","this week","next week","by friday","friday","now","immediately","deadline","overdue"],
    default_priority: "medium",
  },
  milestones: {
    framework: [
      { name: "Clarify the request",  definition_of_done: "Goal, constraints, and success criteria are clear; missing info captured." },
      { name: "Plan milestones",       definition_of_done: "Milestones + timeline + owner (VA/AI/client) defined." },
      { name: "Execute",               definition_of_done: "Tasks completed; blockers handled; progress updates sent." },
      { name: "Close out",             definition_of_done: "Final summary + links/files delivered; next recommended step offered." },
    ],
  },
  automation: {
    escalation_rules: { urgent_and_blocked: true, due_soon_hours: 24 },
  },
  templates: {
    client_clarifying_questions: { max_questions: 3 },
  },
};
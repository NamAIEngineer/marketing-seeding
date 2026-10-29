export const POST_STATUSES = Object.freeze([
  "draft",
  "needs_review",
  "approved",
  "queued",
  "publishing",
  "processing",
  "submit_result_unknown",
  "published",
  "removed",
  "failed",
  "paused",
  "blocked",
  "rejected"
]);

export const TRANSITIONS = Object.freeze({
  draft: ["needs_review", "approved", "rejected"],
  needs_review: ["draft", "approved", "rejected"],
  approved: ["queued", "paused", "rejected"],
  queued: ["publishing", "paused", "failed"],
  publishing: ["processing", "published", "failed", "submit_result_unknown"],
  submit_result_unknown: ["published", "failed"],
  processing: ["published", "failed"],
  published: ["paused", "removed"],
  removed: ["needs_review", "rejected"],
  failed: ["needs_review", "rejected"],
  paused: ["needs_review", "approved", "queued"],
  blocked: ["queued", "paused", "needs_review"],
  rejected: ["draft"]
});

export const CHANNELS = Object.freeze({
  facebook_group: {
    label: "Facebook Groups",
    dailyLimitPerAccount: 3,
    minimumIntervalMinutes: 45,
    requiresRulesReview: true,
    requiresHumanApproval: true,
    replyRequiresApproval: true
  },
  threads: {
    label: "Threads",
    maxContentChars: 500,
    dailyLimitPerAccount: 3,
    minimumIntervalMinutes: 60,
    requiresRulesReview: false,
    requiresHumanApproval: true,
    replyRequiresApproval: true
  },
  reddit: {
    label: "Reddit",
    dailyLimitPerAccount: 3,
    minimumIntervalMinutes: 60,
    requiresRulesReview: true,
    requiresHumanApproval: true,
    replyRequiresApproval: true
  },
  product_hunt: {
    label: "Product Hunt",
    dailyLimitPerAccount: 1,
    minimumIntervalMinutes: 1440,
    requiresRulesReview: true,
    requiresHumanApproval: true,
    replyRequiresApproval: true
  },
  indie_hackers: {
    label: "Indie Hackers",
    dailyLimitPerAccount: 1,
    minimumIntervalMinutes: 720,
    requiresRulesReview: true,
    requiresHumanApproval: true,
    replyRequiresApproval: true
  },
  linkedin: {
    label: "LinkedIn",
    maxContentChars: 3000,
    dailyLimitPerAccount: 3,
    minimumIntervalMinutes: 60,
    requiresRulesReview: false,
    // Legacy/manual posts still require explicit approval, while the
    // standing-autonomous execution path may publish when an exact campaign
    // authorization, readiness, window and grant are present. Keep the
    // legacy flag for that boundary and expose the capability split through
    // the read-only channel projection.
    publishMode: "AUTONOMOUS_WHEN_AUTHORIZED",
    requiresHumanApproval: true,
    replyRequiresApproval: true
  },
  email: {
    label: "Email có đồng ý nhận tin",
    dailyLimitPerAccount: 50,
    minimumIntervalMinutes: 5,
    requiresRulesReview: true,
    requiresHumanApproval: true,
    replyRequiresApproval: true,
    requiresConsent: true
  }
});

export function nowIso(now = new Date()) {
  return now.toISOString();
}

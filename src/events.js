export const POSTHOG_EVENTS = Object.freeze({
  USER_SIGNED_UP: "user_signed_up",
  USER_LOGGED_IN: "user_logged_in",
  EMAIL_VERIFIED: "email_verified",
  ONBOARDING_STARTED: "onboarding_started",
  ONBOARDING_STEP_COMPLETED: "onboarding_step_completed",
  ONBOARDING_COMPLETED: "onboarding_completed",
  PROFILE_COMPLETED: "profile_completed",
  LOCUM_SEARCH_STARTED: "locum_search_started",
  LOCUM_FILTERS_APPLIED: "locum_filters_applied",
  LOCUM_VIEWED: "locum_viewed",
  LOCUM_SAVED: "locum_saved",
  LOCUM_APPLIED: "locum_applied",
  LOCUM_MATCHED: "locum_matched",
  RESERVATION_CREATED: "reservation_created",
  LOCUM_COMPLETED: "locum_completed",
  CLINIC_CREATED_POSTING: "clinic_created_posting",
  CLINIC_UPDATED_POSTING: "clinic_updated_posting",
  CLINIC_FILLED_POSTING: "clinic_filled_posting",
  NOTIFICATION_CLICKED: "notification_clicked"
});

export const ACTIVE_USER_EVENTS = Object.freeze([
  POSTHOG_EVENTS.LOCUM_SEARCH_STARTED,
  POSTHOG_EVENTS.LOCUM_VIEWED,
  POSTHOG_EVENTS.LOCUM_SAVED,
  POSTHOG_EVENTS.LOCUM_APPLIED,
  POSTHOG_EVENTS.RESERVATION_CREATED,
  POSTHOG_EVENTS.LOCUM_COMPLETED,
  POSTHOG_EVENTS.CLINIC_CREATED_POSTING,
  POSTHOG_EVENTS.CLINIC_UPDATED_POSTING,
  POSTHOG_EVENTS.CLINIC_FILLED_POSTING
]);

export const RETENTION_RETURNING_EVENTS = Object.freeze([
  POSTHOG_EVENTS.LOCUM_SEARCH_STARTED,
  POSTHOG_EVENTS.LOCUM_VIEWED,
  POSTHOG_EVENTS.LOCUM_APPLIED,
  POSTHOG_EVENTS.RESERVATION_CREATED,
  POSTHOG_EVENTS.CLINIC_CREATED_POSTING
]);

export const EVENT_PROPERTY_ALLOWLIST = Object.freeze({
  [POSTHOG_EVENTS.USER_SIGNED_UP]: ["user_id", "role", "discoverySource", "province"],
  [POSTHOG_EVENTS.USER_LOGGED_IN]: ["user_id", "role"],
  [POSTHOG_EVENTS.EMAIL_VERIFIED]: ["user_id", "role"],
  [POSTHOG_EVENTS.ONBOARDING_STARTED]: ["user_id", "role"],
  [POSTHOG_EVENTS.ONBOARDING_STEP_COMPLETED]: ["user_id", "role", "step_number", "step_name"],
  [POSTHOG_EVENTS.ONBOARDING_COMPLETED]: ["user_id", "role", "completion_time"],
  [POSTHOG_EVENTS.PROFILE_COMPLETED]: ["user_id", "role", "profile_completion_percentage"],
  [POSTHOG_EVENTS.LOCUM_SEARCH_STARTED]: ["user_id", "specialty", "province"],
  [POSTHOG_EVENTS.LOCUM_FILTERS_APPLIED]: ["user_id", "specialty", "province", "pay_range", "duration", "availability"],
  [POSTHOG_EVENTS.LOCUM_VIEWED]: ["user_id", "locum_id", "job_id", "slug", "specialty", "province", "city", "pay", "job_type"],
  [POSTHOG_EVENTS.LOCUM_SAVED]: ["user_id", "locum_id"],
  [POSTHOG_EVENTS.LOCUM_APPLIED]: ["user_id", "locum_id", "job_id", "slug", "specialty", "province", "city", "pay", "job_type"],
  [POSTHOG_EVENTS.LOCUM_MATCHED]: ["user_id", "locum_id", "match_score"],
  [POSTHOG_EVENTS.RESERVATION_CREATED]: ["user_id", "locum_id"],
  [POSTHOG_EVENTS.LOCUM_COMPLETED]: ["user_id", "locum_id", "duration", "pay", "specialty", "province", "job_type"],
  [POSTHOG_EVENTS.CLINIC_CREATED_POSTING]: ["user_id", "locum_id", "job_id", "slug", "specialty", "province", "city", "job_type", "pay", "facilityEMR", "isPostedByRecruiter", "isUsingJetpay", "isDepositRequested"],
  [POSTHOG_EVENTS.CLINIC_UPDATED_POSTING]: ["user_id", "locum_id", "job_id", "slug", "specialty", "province", "city", "job_type", "pay"],
  [POSTHOG_EVENTS.CLINIC_FILLED_POSTING]: ["user_id", "locum_id", "job_id", "slug", "specialty", "province", "city", "job_type", "pay", "reservation_id"],
  [POSTHOG_EVENTS.NOTIFICATION_CLICKED]: ["user_id", "notification_type"]
});

export const USER_PROPERTY_ALLOWLIST = Object.freeze([
  "user_id",
  "role",
  "specialty",
  "province",
  "discoverySource",
  "isLookingForLocums",
  "profileCompletion",
  "emailVerified",
  "firebase_uid",
  "onboardingStep",
  "isOnboardingCompleted",
  "isProfileComplete",
  "notificationConsent",
  "notificationFrequency",
  "preferredProvinces",
  "savedLocumsCount",
  "appliedLocumsCount",
  "reservedLocumsCount",
  "completedLocumsCount",
  "createdLocumsCount",
  "createdAt",
  "modifiedAt"
]);

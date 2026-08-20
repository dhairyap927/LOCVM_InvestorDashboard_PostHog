function getValue(source, path) {
  return path.split(".").reduce((current, key) => {
    if (current === undefined || current === null) return undefined;
    return current[key];
  }, source);
}

function getObjectId(value) {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (value.$oid) return value.$oid;
  return String(value);
}

function getDate(value) {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (value.$date) return value.$date;
  return undefined;
}

function normalizeString(value) {
  if (value === undefined || value === null) return undefined;
  const cleaned = String(value).trim();
  return cleaned || undefined;
}

export function normalizeRole(role) {
  const cleaned = normalizeString(role);
  if (!cleaned) return undefined;
  return cleaned.toLowerCase();
}

export function normalizeProvince(province) {
  const cleaned = normalizeString(province);
  if (!cleaned) return undefined;

  const normalized = cleaned.toLowerCase();
  const aliases = {
    ontario: "ON",
    on: "ON",
    "british columbia": "BC",
    bc: "BC",
    alberta: "AB",
    ab: "AB",
    manitoba: "MB",
    mb: "MB",
    saskatchewan: "SK",
    sk: "SK",
    quebec: "QC",
    qc: "QC",
    "new brunswick": "NB",
    nb: "NB",
    "nova scotia": "NS",
    ns: "NS",
    "prince edward island": "PE",
    pe: "PE",
    "newfoundland and labrador": "NL",
    nl: "NL",
    yukon: "YT",
    yt: "YT",
    "northwest territories": "NT",
    nt: "NT",
    nunavut: "NU",
    nu: "NU"
  };

  return aliases[normalized] || cleaned.toUpperCase();
}

export function parseLocumPay(locumPay) {
  const cleaned = normalizeString(locumPay);
  if (!cleaned) return undefined;
  const parsed = Number(cleaned.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

export function mapUserProperties(user = {}) {
  const profileCompletion = getValue(user, "profile.profileCompletion");
  const province = user.medicalProvince || getValue(user, "workAddress.province");

  return {
    user_id: getObjectId(user._id),
    firebase_uid: normalizeString(user.firebaseUid),
    role: normalizeRole(user.role),
    specialty: normalizeString(user.medSpeciality),
    province: normalizeProvince(province),
    discoverySource: normalizeString(user.discoverySource),
    isLookingForLocums: Boolean(getValue(user, "preferences.isLookingForLocums")),
    profileCompletion: Number.isFinite(Number(profileCompletion)) ? Number(profileCompletion) : undefined,
    emailVerified: Boolean(user.isEmailVerified),
    onboardingStep: Number.isFinite(Number(user.onboardingStep)) ? Number(user.onboardingStep) : undefined,
    isOnboardingCompleted: Boolean(user.isOnboardingCompleted),
    isProfileComplete: Boolean(user.isProfileComplete),
    notificationConsent: Boolean(user.notificationConsent),
    notificationFrequency: normalizeString(user.notificationFrequency),
    preferredProvinces: Array.isArray(getValue(user, "preferences.preferredProvinces"))
      ? getValue(user, "preferences.preferredProvinces").map(normalizeProvince).filter(Boolean)
      : undefined,
    savedLocumsCount: arrayLength(getValue(user, "reservationsList.savedLocums")),
    appliedLocumsCount: arrayLength(getValue(user, "reservationsList.appliedLocums")),
    reservedLocumsCount: arrayLength(getValue(user, "reservationsList.reservedLocums")),
    completedLocumsCount: arrayLength(getValue(user, "reservationsList.completedLocums")),
    createdLocumsCount: arrayLength(getValue(user, "reservationsList.createdLocums")),
    createdAt: getDate(user.createdAt),
    modifiedAt: getDate(user.modifiedAt)
  };
}

export function mapLocumProperties(locum = {}) {
  const province = getValue(locum, "fullAddress.province");
  const emr = getValue(locum, "facilityInfo.emr") || locum.facilityEMR;

  return {
    locum_id: getObjectId(locum._id),
    job_id: normalizeString(locum.jobId),
    slug: normalizeString(locum.slug),
    creator_user_id: getObjectId(locum.locumCreator),
    post_title: normalizeString(locum.postTitle),
    medProfession: normalizeString(locum.medProfession),
    specialty: normalizeString(locum.medSpeciality),
    job_type: normalizeString(locum.jobType),
    province: normalizeProvince(province),
    city: normalizeString(getValue(locum, "fullAddress.city")),
    facilityName: normalizeString(locum.facilityName),
    facilityEMR: normalizeString(emr),
    locum_pay: parseLocumPay(locum.locumPay),
    locum_pay_raw: normalizeString(locum.locumPay),
    reservation_id: getObjectId(locum.reservationId),
    is_filled: Boolean(getObjectId(locum.reservationId)),
    isPostedByRecruiter: Boolean(locum.isPostedByRecruiter),
    isUsingJetpay: Boolean(locum.isUsingJetpay),
    isDepositRequested: Boolean(locum.isDepositRequested),
    start_date: getDate(getValue(locum, "dateRange.from")),
    end_date: getDate(getValue(locum, "dateRange.to")),
    createdAt: getDate(locum.createdAt),
    modifiedAt: getDate(locum.modifiedAt)
  };
}

export function mapSignupEvent(user = {}) {
  const userProperties = mapUserProperties(user);

  return {
    user_id: userProperties.user_id,
    role: userProperties.role,
    discoverySource: userProperties.discoverySource,
    province: userProperties.province
  };
}

export function mapClinicPostingEvent(user = {}, locum = {}) {
  const userProperties = mapUserProperties(user);
  const locumProperties = mapLocumProperties(locum);

  return {
    user_id: userProperties.user_id,
    locum_id: locumProperties.locum_id,
    specialty: locumProperties.specialty,
    province: locumProperties.province,
    job_type: locumProperties.job_type,
    pay: locumProperties.locum_pay
  };
}

export function mapPhysicianLocumEvent(user = {}, locum = {}) {
  const userProperties = mapUserProperties(user);
  const locumProperties = mapLocumProperties(locum);

  return {
    user_id: userProperties.user_id,
    locum_id: locumProperties.locum_id,
    specialty: locumProperties.specialty,
    province: locumProperties.province,
    pay: locumProperties.locum_pay
  };
}

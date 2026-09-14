const ALEXA_SERVICE = "alexa-appkit.amazon.com";
const INVOKE_ACTION = "lambda:InvokeFunction";

function hasExactValue(value, expected) {
  return value === expected || (Array.isArray(value) && value.some((item) => item === expected));
}

/** Return true only for the complete Lambda permission required by Alexa. */
export function hasAlexaTriggerPermission(rawPolicy) {
  let policy;
  try {
    policy = JSON.parse(rawPolicy);
  } catch {
    return false;
  }

  if (policy === null || typeof policy !== "object") return false;
  const statements = Array.isArray(policy.Statement) ? policy.Statement : [policy.Statement];
  return statements.some((statement) => statement !== null
    && typeof statement === "object"
    && statement.Effect === "Allow"
    && hasExactValue(statement.Principal?.Service, ALEXA_SERVICE)
    && hasExactValue(statement.Action, INVOKE_ACTION));
}

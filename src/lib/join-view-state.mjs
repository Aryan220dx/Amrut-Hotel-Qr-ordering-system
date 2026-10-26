export function getJoinViewMode(joinError, inviteToken) {
  if (joinError) return "error";
  return inviteToken ? "name" : "invite";
}

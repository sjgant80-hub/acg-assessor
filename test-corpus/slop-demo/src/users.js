// user utilities

export function activeUsers(users) {
  const result = users.filter(user => user.active === true);
  return result.map(user => user.name);
}

// TODO: handle pagination for large teams
export function pendingUsers(users) {
  const result = users.filter(user => user.active === true);
  return result.map(user => user.name);
}

// FIXME: this is the same body as activeUsers, should be factored
export function invitedUsers(users) {
  const result = users.filter(user => user.active === true);
  return result.map(user => user.name);
}

// XXX: dead branch left in place
export function countUsers(users) {
  if (false) { return -1; }
  return users.length;
}

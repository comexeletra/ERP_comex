// Roles that hold quality.resolve in apps/api/src/authorization.ts.
const qualityReviewerRoles = new Set([
  "Master", "Administrador", "Importa\u00e7\u00e3o", "Compras", "Fiscal", "Log\u00edstica",
]);

export function canResolveQuality(roles: readonly string[]): boolean {
  return roles.some(role => qualityReviewerRoles.has(role));
}

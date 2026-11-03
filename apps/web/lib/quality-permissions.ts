// Roles that hold quality.resolve in apps/api/src/authorization.ts.
const qualityReviewerRoles = new Set([
  "Master", "Administrador", "Importa\u00e7\u00e3o", "Compras", "Fiscal", "Log\u00edstica",
]);

export function canResolveQuality(roles: readonly string[]): boolean {
  return roles.some(role => qualityReviewerRoles.has(role));
}

// Roles that hold purchase-orders.write, and the catalog writers of products and NCMs (apps/api/src/catalog.ts).
const poWriterRoles = new Set(["Master", "Administrador", "Importação", "Compras"]);
const productWriterRoles = new Set(["Master", "Administrador", "Compras"]);
const ncmWriterRoles = new Set(["Master", "Administrador", "Fiscal"]);

export function canFixQuality(roles: readonly string[]): boolean { return roles.some(role => poWriterRoles.has(role)); }
export function canRegisterProducts(roles: readonly string[]): boolean { return roles.some(role => productWriterRoles.has(role)); }
export function canRegisterNcms(roles: readonly string[]): boolean { return roles.some(role => ncmWriterRoles.has(role)); }

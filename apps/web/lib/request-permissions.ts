const requestWriterRoles = new Set(["Master", "Administrador", "Importação"]);

export function canWriteRequests(roles: readonly string[]): boolean {
  return roles.some(role => requestWriterRoles.has(role));
}

/** Open sections of the sidebar: the section of the current page is always added, the others follow the user's clicks. */
export function withActiveSidebarGroup(open: readonly string[], activeGroup: string | undefined): readonly string[] {
  return activeGroup === undefined || open.includes(activeGroup) ? open : [...open, activeGroup];
}

export function toggleSidebarGroup(open: readonly string[], group: string): readonly string[] {
  return open.includes(group) ? open.filter(name => name !== group) : [...open, group];
}

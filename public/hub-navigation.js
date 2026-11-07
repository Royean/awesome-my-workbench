const sections = [
  { id: 'development', name: '开发' },
  { id: 'ui-components', name: '组件' },
  { id: 'ai-teams', name: 'AI Teams' }
];

export function isHubRoute(route) {
  return sections.some(section => section.id === route?.split('/')[0]);
}

export function hubNavigation(page, placement) {
  return `<nav class="hub-nav hub-nav--${placement}" aria-label="全局入口">${sections.map(({ id, name }) =>
    `<button type="button" data-action="nav:${id}"${page === id ? ' aria-current="page"' : ''}>${name}</button>`
  ).join('')}</nav>`;
}

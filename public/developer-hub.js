import { createHubComponents } from './hub-components.js';
import { createHubDevelopment } from './hub-development.js';
import { createHubTeams } from './hub-teams.js';

export function createDeveloperHub(ctx) {
  const teams = createHubTeams(ctx);
  const developmentContext = Object.create(ctx);
  developmentContext.onIssuesChanged = teams.invalidateIssues;
  const views = {
    development: createHubDevelopment(developmentContext),
    'ui-components': createHubComponents(ctx),
    'ai-teams': teams
  };
  let activeView;
  function leave() {
    activeView?.cleanup?.();
    activeView = null;
  }
  return {
    leave,
    render(route) {
      const view = views[route.split('/')[0]];
      if(activeView!==view){leave();activeView=view;}
      const app = document.querySelector('#app');
      app.innerHTML = `<div class="app hub-shell"><div class="workspace"><main class="main hub-main"><div class="hub-content">${view.render(route)}</div></main></div></div>`;
      ctx.decorate();
      view.bind(app.querySelector('.hub-content'), route);
    },
    cleanup() {
      activeView=null;
      for (const view of Object.values(views)) view.cleanup?.();
    }
  };
}

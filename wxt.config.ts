import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'HiWi AI Assistant',
    description: 'Read and display the title, URL, and text of the current page.',
    permissions: ['activeTab', 'scripting', 'sidePanel', 'storage'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Open HiWi AI Assistant',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
  },
});

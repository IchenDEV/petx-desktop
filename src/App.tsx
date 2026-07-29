import { CompanionView } from './companion/CompanionView';
import { LibraryView } from './library/LibraryView';
import { getWindowRole } from './platform';
import { SettingsView } from './settings/SettingsView';

export function App() {
  switch (getWindowRole()) {
    case 'settings':
      return <SettingsView />;
    case 'library':
      return <LibraryView />;
    case 'main':
      return <CompanionView />;
  }
}

import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { DocPage } from './pages/DocPage';
import { SearchPage } from './pages/SearchPage';
import { PracticePage } from './pages/PracticePage';
import { SavedPage } from './pages/SavedPage';
import { NotFound } from './pages/NotFound';
import { TopicLibrary } from './pages/TopicLibrary';
import { StudyPlan } from './pages/StudyPlan';
import { SettingsPage } from './pages/SettingsPage';
import { jsonFetcher } from './lib/fetcher';

const router = createBrowserRouter(
  [
    {
      element: <Layout />,
      children: [
        { index: true, element: <Dashboard /> },
        { path: 'topics', element: <TopicLibrary /> },
        { path: 'plan', element: <StudyPlan /> },
        { path: 'settings', element: <SettingsPage /> },
        { path: 'docs/:slug', element: <DocPage /> },
        { path: 'search', element: <SearchPage /> },
        { path: 'practice', element: <PracticePage /> },
        { path: 'saved', element: <SavedPage /> },
        { path: '*', element: <NotFound /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
);

export function App() {
  return (
    <SWRConfig
      value={{
        fetcher: jsonFetcher,
        errorRetryCount: 2,
        onError: (err, key) => console.warn(`[swr] ${String(key)}:`, err),
      }}
    >
      <RouterProvider router={router} />
    </SWRConfig>
  );
}

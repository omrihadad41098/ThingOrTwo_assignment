import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { FanProvider, useFan } from './fan';
import { Admin } from './pages/Admin';
import { EventPage } from './pages/Event';
import { Events } from './pages/Events';
import { Login } from './pages/Login';
import { Tickets } from './pages/Tickets';

export function App() {
  return (
    <FanProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Login />} />
          <Route path="/events" element={<Events />} />
          <Route path="/events/:id" element={<EventPage />} />
          <Route path="/tickets" element={<Tickets />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<HomeRedirect />} />
        </Route>
      </Routes>
    </FanProvider>
  );
}

function HomeRedirect() {
  const { fan } = useFan();
  return <Navigate to={fan ? '/events' : '/'} replace />;
}

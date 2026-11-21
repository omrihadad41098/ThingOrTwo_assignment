import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useFan } from '../fan';

export function Layout() {
  const { fan, switchFan } = useFan();
  const navigate = useNavigate();
  return (
    <div className="app">
      <header className="top">
        <Link to={fan ? '/events' : '/'} className="brand">
          SeatRush
        </Link>
        <nav>
          {fan ? <NavLink to="/events">Shows</NavLink> : null}
          {fan ? <NavLink to="/tickets">My tickets</NavLink> : null}
          <NavLink to="/admin">Admin</NavLink>
        </nav>
        <div className="who">
          {fan ? <span>{fan}</span> : <span>No name yet</span>}
          {fan ? (
            <button
              type="button"
              className="text"
              onClick={() => {
                switchFan();
                navigate('/');
              }}
            >
              Switch
            </button>
          ) : null}
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

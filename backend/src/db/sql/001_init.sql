CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  venue text NOT NULL,
  starts_at timestamptz NOT NULL,
  drop_at timestamptz NOT NULL,
  row_count integer NOT NULL,
  seats_per_row integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (drop_at < starts_at),
  CHECK (row_count BETWEEN 1 AND 60 AND seats_per_row BETWEEN 1 AND 100)
);

CREATE TABLE zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events (id),
  name text NOT NULL,
  from_row integer NOT NULL,
  to_row integer NOT NULL,
  price_agorot integer NOT NULL CHECK (price_agorot >= 0),
  CHECK (from_row >= 0 AND to_row >= from_row),
  UNIQUE (event_id, name)
);

CREATE TABLE holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events (id),
  user_id uuid NOT NULL REFERENCES users (id),
  status text NOT NULL CHECK (status IN ('active', 'released', 'converted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE seats (
  event_id uuid NOT NULL REFERENCES events (id),
  row_index integer NOT NULL,
  seat_number integer NOT NULL,
  zone_id uuid NOT NULL REFERENCES zones (id),
  state text NOT NULL CHECK (state IN ('available', 'held', 'sold')),
  current_hold_id uuid REFERENCES holds (id),
  PRIMARY KEY (event_id, row_index, seat_number)
);

CREATE TABLE hold_seats (
  hold_id uuid NOT NULL REFERENCES holds (id),
  event_id uuid NOT NULL,
  row_index integer NOT NULL,
  seat_number integer NOT NULL,
  PRIMARY KEY (hold_id, event_id, row_index, seat_number),
  FOREIGN KEY (event_id, row_index, seat_number)
    REFERENCES seats (event_id, row_index, seat_number)
);

CREATE TABLE user_event_locks (
  user_id uuid NOT NULL REFERENCES users (id),
  event_id uuid NOT NULL REFERENCES events (id),
  PRIMARY KEY (user_id, event_id)
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id uuid NOT NULL REFERENCES holds (id),
  event_id uuid NOT NULL REFERENCES events (id),
  user_id uuid NOT NULL REFERENCES users (id),
  subtotal_agorot integer NOT NULL,
  discount_agorot integer NOT NULL,
  total_agorot integer NOT NULL,
  promo_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_hold_id_key UNIQUE (hold_id),
  CHECK (
    subtotal_agorot >= 0
    AND discount_agorot >= 0
    AND total_agorot >= 0
    AND total_agorot = subtotal_agorot - discount_agorot
  )
);

CREATE TABLE order_seats (
  order_id uuid NOT NULL REFERENCES orders (id),
  event_id uuid NOT NULL,
  row_index integer NOT NULL,
  seat_number integer NOT NULL,
  price_agorot integer NOT NULL CHECK (price_agorot >= 0),
  PRIMARY KEY (order_id, event_id, row_index, seat_number),
  FOREIGN KEY (event_id, row_index, seat_number)
    REFERENCES seats (event_id, row_index, seat_number)
);

CREATE TABLE promo_redemptions (
  code text NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id),
  order_id uuid NOT NULL REFERENCES orders (id),
  PRIMARY KEY (code, user_id)
);

CREATE INDEX holds_live_idx
  ON holds (user_id, event_id, expires_at)
  WHERE status = 'active';

CREATE INDEX seats_current_hold_idx
  ON seats (current_hold_id)
  WHERE current_hold_id IS NOT NULL;

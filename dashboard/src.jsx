import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

async function request(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return response.json();
}

function Dashboard() {
  const [events, setEvents] = useState(null);
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [replaying, setReplaying] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function load() {
      try {
        const options = { signal: controller.signal };
        const [list, event] = await Promise.all([
          request('/events', options),
          selected ? request(`/events/${encodeURIComponent(selected)}`, options) : null,
        ]);
        if (controller.signal.aborted) return;
        setEvents(list.events);
        setDetails(event);
        setError('');
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 1000);
      }
    }
    load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [selected, refresh]);

  async function replay() {
    setReplaying(true);
    try {
      const result = await request(`/events/${encodeURIComponent(selected)}/replay`, { method: 'POST' });
      setSelected(result.id);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setReplaying(false);
    }
  }

  const active = details?.id === selected ? details : null;
  return (
    <main>
      <header>
        <h1>Webhook deliveries</h1>
        <button onClick={() => setRefresh(refresh + 1)}>Refresh</button>
      </header>
      {error && <p role="alert">{error}</p>}
      <div className="panels">
        <section aria-labelledby="recent">
          <h2 id="recent">Recent deliveries</h2>
          {events === null && !error && <p>Loading deliveries…</p>}
          {events?.length === 0 && <p>Send an event to see it here.</p>}
          <ul>
            {events?.map((event) => (
              <li key={event.id}>
                <button className="delivery" aria-pressed={selected === event.id}
                  onClick={() => setSelected(event.id)} disabled={replaying}>
                  <strong>{event.type}</strong>
                  <span className={event.status}>{event.status}</span>
                  <small>{event.id}</small>
                  {event.replayOf && <small>Replay of {event.replayOf}</small>}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="history">
          <h2 id="history">Attempt history</h2>
          {!selected && <p>Select a delivery to inspect its attempts.</p>}
          {selected && !active && !error && <p>Loading attempt history…</p>}
          {active && (
            <>
              <p className={active.status}>{active.status}</p>
              {active.status === 'failed' && (
                <button className="primary" onClick={replay} disabled={replaying}>
                  {replaying ? 'Queuing…' : 'Replay delivery'}
                </button>
              )}
              {active.attempts.length === 0 && <p>No completed attempts yet.</p>}
              {active.attempts.length > 0 && (
                <table>
                  <thead><tr><th>Attempt</th><th>Result</th><th>Finished</th></tr></thead>
                  <tbody>
                    {active.attempts.map((attempt) => (
                      <tr key={attempt.number}>
                        <td>{attempt.number}</td>
                        <td>{attempt.httpStatus ?? 'Network error'} · {attempt.outcome}</td>
                        <td>{new Date(attempt.finishedAt).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<Dashboard />);

"use client";

import { useMemo, useState } from "react";

type Provider = "gmail" | "outlook" | "icloud";
type Filter = "Todos" | "Publicidad" | "Newsletters" | "Notificaciones";

const providers = {
  gmail: {
    name: "Gmail",
    email: "maria@gmail.com",
    mark: "M",
    tone: "gmail",
  },
  outlook: {
    name: "Outlook",
    email: "maria@outlook.com",
    mark: "O",
    tone: "outlook",
  },
  icloud: {
    name: "iCloud",
    email: "maria@icloud.com",
    mark: "●",
    tone: "icloud",
  },
} as const;

const senders = [
  { id: 1, name: "Temu", domain: "mail.temu.com", count: 84, category: "Publicidad", color: "#f2612f", initials: "T", last: "Hoy", unsub: true },
  { id: 2, name: "Canva", domain: "canva.com", count: 31, category: "Newsletters", color: "#7b61ff", initials: "Ca", last: "Ayer", unsub: true },
  { id: 3, name: "LinkedIn", domain: "linkedin.com", count: 27, category: "Notificaciones", color: "#1676b7", initials: "in", last: "22 jul", unsub: true },
  { id: 4, name: "AliExpress", domain: "aliexpress.com", count: 22, category: "Publicidad", color: "#e74334", initials: "A", last: "21 jul", unsub: true },
  { id: 5, name: "Medium Daily Digest", domain: "medium.com", count: 18, category: "Newsletters", color: "#111827", initials: "M", last: "19 jul", unsub: true },
  { id: 6, name: "Amazon", domain: "amazon.com", count: 13, category: "Notificaciones", color: "#ef9d24", initials: "a", last: "18 jul", unsub: false },
];

function Icon({ name }: { name: "shield" | "search" | "spark" | "history" | "settings" | "logout" | "trash" | "ban" | "chevron" }) {
  const paths = {
    shield: <><path d="M12 3 5 6v5c0 4.5 2.9 7.6 7 9 4.1-1.4 7-4.5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></>,
    search: <><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></>,
    spark: <><path d="m12 3 1.2 4.8L18 9l-4.8 1.2L12 15l-1.2-4.8L6 9l4.8-1.2L12 3Z"/><path d="m18 15 .6 2.4L21 18l-2.4.6L18 21l-.6-2.4L15 18l2.4-.6L18 15Z"/></>,
    history: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8"/><path d="M4 4v4h4M12 8v5l3 2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    logout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M9 12h9"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></>,
    ban: <><circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export default function Home() {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [filter, setFilter] = useState<Filter>("Todos");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [notice, setNotice] = useState("");

  const rows = useMemo(() => senders.filter((sender) => {
    const matchesFilter = filter === "Todos" || sender.category === filter;
    const matchesQuery = `${sender.name} ${sender.domain}`.toLowerCase().includes(query.toLowerCase());
    return matchesFilter && matchesQuery;
  }), [filter, query]);

  const chosenCount = senders.filter((sender) => selected.includes(sender.id)).reduce((total, sender) => total + sender.count, 0);

  const toggle = (id: number) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const act = (message: string) => {
    if (!selected.length) return;
    setNotice(message);
    setSelected([]);
    window.setTimeout(() => setNotice(""), 3500);
  };

  if (!provider) {
    return (
      <main className="welcome">
        <div className="welcome-glow" />
        <nav className="brand-bar">
          <div className="brand"><span className="brand-icon"><Icon name="shield" /></span>Spam<span>Kill</span></div>
          <span className="privacy-pill"><span /> Tus correos permanecen privados</span>
        </nav>
        <section className="provider-shell">
          <div className="eyebrow"><Icon name="spark" /> Limpia tu bandeja en minutos</div>
          <h1>Recupera el control<br />de tu correo.</h1>
          <p>Elige una cuenta para analizar suscripciones, detener publicidad y limpiar mensajes. Cada cuenta funciona por separado.</p>
          <div className="provider-grid">
            {(Object.keys(providers) as Provider[]).map((key) => {
              const item = providers[key];
              return (
                <button key={key} className={`provider-card ${item.tone}`} onClick={() => setProvider(key)}>
                  <span className="provider-logo">{item.mark}</span>
                  <span><strong>Continuar con {item.name}</strong><small>Conectar cuenta de forma segura</small></span>
                  <Icon name="chevron" />
                </button>
              );
            })}
          </div>
          <div className="trust-row"><span>✓ Sin bandeja unificada</span><span>✓ Acciones reversibles</span><span>✓ Tú decides qué eliminar</span></div>
        </section>
      </main>
    );
  }

  const account = providers[provider];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-icon"><Icon name="shield" /></span>Spam<span>Kill</span></div>
        <div className="account-card">
          <span className={`account-mark ${account.tone}`}>{account.mark}</span>
          <span><strong>{account.name}</strong><small>{account.email}</small></span>
          <button aria-label="Cambiar cuenta" onClick={() => { setProvider(null); setSelected([]); }}><Icon name="chevron" /></button>
        </div>
        <nav className="side-nav">
          <button className="active"><Icon name="spark" /> Limpieza inteligente <b>195</b></button>
          <button><Icon name="history" /> Historial</button>
          <button><Icon name="settings" /> Configuración</button>
        </nav>
        <div className="privacy-note">
          <span><Icon name="shield" /></span>
          <strong>Privacidad primero</strong>
          <p>Solo analizamos lo necesario para detectar suscripciones.</p>
        </div>
        <button className="disconnect" onClick={() => setProvider(null)}><Icon name="logout" /> Desconectar cuenta</button>
      </aside>

      <main className="dashboard">
        <header className="dash-header">
          <div>
            <p className="breadcrumb">{account.name} / Limpieza</p>
            <h1>Tu bandeja, bajo control.</h1>
            <p>Encontramos <strong>195 mensajes</strong> de 6 remitentes que puedes revisar.</p>
          </div>
          <div className="safety"><span>●</span><div><strong>Modo seguro activo</strong><small>Los correos irán a la papelera</small></div></div>
        </header>

        <section className="stats">
          <article><span className="stat-icon violet"><Icon name="spark" /></span><div><small>Mensajes detectados</small><strong>195</strong><em>Últimos 90 días</em></div></article>
          <article><span className="stat-icon orange">%</span><div><small>Publicidad</small><strong>106</strong><em>54% del total</em></div></article>
          <article><span className="stat-icon green"><Icon name="ban" /></span><div><small>Desuscripción disponible</small><strong>5</strong><em>De 6 remitentes</em></div></article>
        </section>

        <section className="mail-panel">
          <div className="toolbar">
            <div className="filters">
              {(["Todos", "Publicidad", "Newsletters", "Notificaciones"] as Filter[]).map((item) => <button key={item} onClick={() => setFilter(item)} className={filter === item ? "active" : ""}>{item}</button>)}
            </div>
            <label className="search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar remitente..." /></label>
          </div>

          <div className="table-head">
            <label><input type="checkbox" checked={rows.length > 0 && rows.every((row) => selected.includes(row.id))} onChange={() => setSelected(rows.every((row) => selected.includes(row.id)) ? [] : rows.map((row) => row.id))} /> Remitente</label>
            <span>Categoría</span><span>Mensajes</span><span>Último</span><span>Desuscripción</span>
          </div>

          <div className="sender-list">
            {rows.map((sender) => (
              <label className={`sender-row ${selected.includes(sender.id) ? "selected" : ""}`} key={sender.id}>
                <span className="sender-main"><input type="checkbox" checked={selected.includes(sender.id)} onChange={() => toggle(sender.id)} /><i style={{ background: sender.color }}>{sender.initials}</i><span><strong>{sender.name}</strong><small>{sender.domain}</small></span></span>
                <span><b className={`tag ${sender.category.toLowerCase()}`}>{sender.category}</b></span>
                <strong className="message-count">{sender.count}</strong>
                <span className="last-date">{sender.last}</span>
                <span className={sender.unsub ? "available" : "manual"}>{sender.unsub ? "✓ Disponible" : "Manual"}</span>
              </label>
            ))}
          </div>

          {selected.length > 0 && (
            <div className="action-bar">
              <div><strong>{selected.length} remitentes seleccionados</strong><small>{chosenCount} mensajes afectados</small></div>
              <button className="unsubscribe" onClick={() => act("Desuscripciones programadas correctamente.")}><Icon name="ban" /> Desuscribir</button>
              <button className="delete" onClick={() => act(`${chosenCount} mensajes enviados a la papelera.`)}><Icon name="trash" /> Desuscribir y limpiar</button>
            </div>
          )}
        </section>
        <p className="footer-copy">SpamKill nunca elimina mensajes de forma permanente sin tu confirmación.</p>
      </main>
      {notice && <div className="toast">✓ {notice}</div>}
    </div>
  );
}

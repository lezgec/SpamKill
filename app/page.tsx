"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Provider = "gmail" | "outlook" | "icloud";
type Category = "Publicidad" | "Newsletters" | "Notificaciones";
type Filter = "Todos" | Category | "Dudosos" | "Seguros";
type ScanRange = "all" | "30d" | "90d" | "1y" | "custom";
type Sender = {
  id: string;
  name: string;
  domain: string;
  count: number;
  category: Category;
  detectedCategory?: Category;
  detectedReason?: string;
  classificationReason?: string;
  confidence?: "high" | "medium" | "low";
  doubtful?: boolean;
  corrected?: boolean;
  safe?: boolean;
  color: string;
  initials: string;
  last: string;
  unsub: boolean;
  primaryMessageId: string;
  latestAt: number;
};
type HistoryRecord = {
  id: string;
  senderEmail: string;
  senderName: string;
  senderDomain: string;
  status: "verifying" | "confirmed" | "manual" | "failed";
  requestedAt: number;
  updatedAt: number;
  lastSeenAt: number | null;
  messagesTrashed: number;
  manualUrl: string | null;
};
type DetailMessage = {
  id: string;
  subject: string;
  snippet: string;
  from: string;
  receivedAt: number;
  hasUnsubscribe: boolean;
};
type TrashGroup = { id: string; messageIds: string[] };
type PendingAction =
  | { scope: "bulk"; action: "unsubscribe" | "unsubscribe_and_trash" }
  | { scope: "detail"; action: "unsubscribe" | "trash" };
type UndoState = {
  groups: TrashGroup[];
  senders: Sender[];
  detailMessages: DetailMessage[];
  detailSender: Sender | null;
};
type ProviderSnapshot = {
  email: string;
  senders: Sender[];
  scanned: number;
  estimate: number;
  scanRange: ScanRange;
  customAfter: string;
  customBefore: string;
  syncedAt: number | null;
};

const providers = {
  gmail: { name: "Gmail", email: "Cuenta de Google", mark: "M", tone: "gmail" },
  outlook: { name: "Outlook", email: "Cuenta de Microsoft", mark: "O", tone: "outlook" },
  icloud: { name: "iCloud", email: "Próximamente", mark: "●", tone: "icloud" },
} as const;
const rangeLabels: Record<ScanRange, string> = {
  all: "Todos los correos",
  "30d": "Últimos 30 días",
  "90d": "Últimos 90 días",
  "1y": "Último año",
  custom: "Fechas personalizadas",
};
const categoryOptions: Category[] = ["Publicidad", "Newsletters", "Notificaciones"];

function mailApiPath(provider: Provider | null): "google" | "outlook" {
  if (provider === "gmail") return "google";
  if (provider === "outlook") return "outlook";
  throw new Error("Selecciona una cuenta de correo.");
}

const demoSenders: Sender[] = [
  { id: "temu", name: "Temu", domain: "mail.temu.com", count: 84, category: "Publicidad", color: "#f2612f", initials: "T", last: "Hoy", unsub: true, primaryMessageId: "", latestAt: 0 },
  { id: "canva", name: "Canva", domain: "canva.com", count: 31, category: "Newsletters", color: "#7b61ff", initials: "CA", last: "Ayer", unsub: true, primaryMessageId: "", latestAt: 0 },
  { id: "linkedin", name: "LinkedIn", domain: "linkedin.com", count: 27, category: "Notificaciones", color: "#1676b7", initials: "IN", last: "22 jul", unsub: true, primaryMessageId: "", latestAt: 0 },
  { id: "aliexpress", name: "AliExpress", domain: "aliexpress.com", count: 22, category: "Publicidad", color: "#e74334", initials: "A", last: "21 jul", unsub: true, primaryMessageId: "", latestAt: 0 },
  { id: "medium", name: "Medium Daily Digest", domain: "medium.com", count: 18, category: "Newsletters", color: "#111827", initials: "M", last: "19 jul", unsub: true, primaryMessageId: "", latestAt: 0 },
  { id: "amazon", name: "Amazon", domain: "amazon.com", count: 13, category: "Notificaciones", color: "#ef9d24", initials: "A", last: "18 jul", unsub: false, primaryMessageId: "", latestAt: 0 },
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

const historyStatus = {
  verifying: { label: "Verificando", detail: "Esperando 7 días sin nuevos mensajes" },
  confirmed: { label: "Confirmada", detail: "No llegaron mensajes nuevos" },
  manual: { label: "Revisión manual", detail: "La baja requiere que completes el proceso desde el correo" },
  failed: { label: "Fallida", detail: "Llegó publicidad después de la solicitud" },
} as const;

function mergeSenderPages(current: Sender[], incoming: Sender[]): Sender[] {
  const grouped = new Map(current.map((sender) => [sender.id, { ...sender }]));
  for (const sender of incoming) {
    const existing = grouped.get(sender.id);
    if (!existing) {
      grouped.set(sender.id, { ...sender });
      continue;
    }
    existing.count += sender.count;
    existing.unsub = existing.unsub || sender.unsub;
    if (sender.latestAt > existing.latestAt) {
      existing.latestAt = sender.latestAt;
      existing.last = sender.last;
      existing.primaryMessageId = sender.primaryMessageId;
      existing.category = sender.category;
      existing.detectedCategory = sender.detectedCategory;
      existing.detectedReason = sender.detectedReason;
      existing.classificationReason = sender.classificationReason;
      existing.confidence = sender.confidence;
      existing.doubtful = sender.doubtful;
      existing.corrected = sender.corrected;
      existing.safe = sender.safe;
    }
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count);
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function HistoryView({
  records,
  loading,
  onRefresh,
  providerName,
}: {
  records: HistoryRecord[];
  loading: boolean;
  onRefresh: () => void;
  providerName: string;
}) {
  return (
    <main className="dashboard">
      <header className="dash-header history-heading">
        <div>
          <p className="breadcrumb">{providerName} / Historial</p>
          <h1>Seguimiento de desuscripciones.</h1>
          <p>Comprobamos si cada remitente respeta tu solicitud después de siete días.</p>
        </div>
        <button className="refresh-button" onClick={onRefresh} disabled={loading}>
          <Icon name="history" /> {loading ? "Comprobando..." : "Comprobar ahora"}
        </button>
      </header>
      <section className="history-summary">
        <article><strong>{records.length}</strong><span>Solicitudes registradas</span></article>
        <article><strong>{records.filter((item) => item.status === "confirmed").length}</strong><span>Confirmadas</span></article>
        <article><strong>{records.filter((item) => item.status === "failed").length}</strong><span>Fallidas</span></article>
      </section>
      <section className="history-panel">
        {loading && <div className="loading-state"><span className="loader" /> Consultando el historial...</div>}
        {!loading && records.length === 0 && (
          <div className="empty-state history-empty">
            <span><Icon name="history" /></span>
            <strong>Aún no hay desuscripciones registradas</strong>
            <p>Selecciona un remitente en Limpieza inteligente y pulsa Desuscribir.</p>
          </div>
        )}
        {!loading && records.map((record) => {
          const status = historyStatus[record.status];
          return (
            <article className="history-row" key={record.id}>
              <span className="history-avatar">{record.senderName.slice(0, 2).toUpperCase()}</span>
              <div className="history-sender">
                <strong>{record.senderName}</strong>
                <small>{record.senderDomain}</small>
              </div>
              <div className="history-date">
                <small>Solicitud enviada</small>
                <strong>{new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" }).format(new Date(record.requestedAt))}</strong>
              </div>
              <div className="history-trash">
                <small>Mensajes a papelera</small>
                <strong>{record.messagesTrashed}</strong>
              </div>
              <div className={`history-status ${record.status}`}>
                <b>{status.label}</b>
                <small>{status.detail}</small>
                {record.status === "manual" && record.manualUrl && (
                  <a
                    className="history-manual-link"
                    href={record.manualUrl}
                    target={record.manualUrl.startsWith("mailto:") ? undefined : "_blank"}
                    rel="noreferrer noopener"
                  >
                    {record.manualUrl.startsWith("mailto:")
                      ? "Abrir solicitud por correo"
                      : "Abrir página de desuscripción"}
                    <span aria-hidden="true"> ↗</span>
                  </a>
                )}
                {record.status === "manual" && !record.manualUrl && (
                  <small className="history-manual-missing">
                    Repite la solicitud para buscar un enlace seguro.
                  </small>
                )}
              </div>
            </article>
          );
        })}
      </section>
      <p className="footer-copy">La confirmación se basa en si el remitente vuelve a enviarte mensajes después de la solicitud.</p>
    </main>
  );
}

export default function Home() {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [gmailEmail, setGmailEmail] = useState("");
  const [outlookEmail, setOutlookEmail] = useState("");
  const [senders, setSenders] = useState<Sender[]>(demoSenders);
  const [scanned, setScanned] = useState(195);
  const [estimate, setEstimate] = useState(195);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"cleanup" | "history">("cleanup");
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("Todos");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [scanRange, setScanRange] = useState<ScanRange>("90d");
  const [customOpen, setCustomOpen] = useState(false);
  const [customAfter, setCustomAfter] = useState("");
  const [customBefore, setCustomBefore] = useState("");
  const [quotaWait, setQuotaWait] = useState(0);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [detailSender, setDetailSender] = useState<Sender | null>(null);
  const [detailMessages, setDetailMessages] = useState<DetailMessage[]>([]);
  const [detailSelected, setDetailSelected] = useState<string[]>([]);
  const [detailPageToken, setDetailPageToken] = useState<string | null>(null);
  const [detailEstimate, setDetailEstimate] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [preferenceBusy, setPreferenceBusy] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const providerSnapshotsRef = useRef<Partial<Record<"gmail" | "outlook", ProviderSnapshot>>>({});

  const restoreProviderSnapshot = useCallback((key: "gmail" | "outlook"): boolean => {
    const snapshot = providerSnapshotsRef.current[key];
    if (!snapshot) return false;
    setSenders(snapshot.senders);
    setScanned(snapshot.scanned);
    setEstimate(snapshot.estimate);
    setScanRange(snapshot.scanRange);
    setCustomAfter(snapshot.customAfter);
    setCustomBefore(snapshot.customBefore);
    setCustomOpen(snapshot.scanRange === "custom");
    setSyncedAt(snapshot.syncedAt);
    setSelected([]);
    setLoading(false);
    return true;
  }, []);

  const showNotice = (message: string, duration = 4200) => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice("");
      setUndoState(null);
      noticeTimerRef.current = null;
    }, duration);
  };

  const runScan = useCallback(async (
    range: ScanRange,
    after = "",
    before = "",
  ) => {
    const activeProvider = provider === "outlook" ? "outlook" : "gmail";
    const apiPath = mailApiPath(activeProvider);
    scanAbortRef.current?.abort();
    const controller = new AbortController();
    scanAbortRef.current = controller;
    setLoading(true);
    setError("");
    setSelected([]);
    setSenders([]);
    setScanned(0);
    setEstimate(0);
    setScanRange(range);
    setCustomOpen(range === "custom");

    let pageToken: string | null = null;
    let syncStartHistoryId = "";
    let totalScanned = 0;
    let accumulated: Sender[] = [];
    let scannedEmail = "";
    let completed = false;
    try {
      do {
        const url = new URL(`/api/${apiPath}/scan`, window.location.origin);
        url.searchParams.set("range", range);
        if (after) url.searchParams.set("after", after);
        if (before) url.searchParams.set("before", before);
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        if (syncStartHistoryId) url.searchParams.set("syncStartHistoryId", syncStartHistoryId);
        let response: Response;
        let data: {
          groups?: Sender[];
          email?: string;
          scanned?: number;
          nextPageToken?: string | null;
          resultSizeEstimate?: number;
          syncStartHistoryId?: string | null;
          retryAfter?: number;
          error?: string;
        };
        while (true) {
          response = await fetch(url, { signal: controller.signal });
          data = await response.json() as typeof data;
          if (response.status !== 429) break;
          let seconds = data.retryAfter ?? 60;
          while (seconds > 0) {
            setQuotaWait(seconds);
            await pause(1000, controller.signal);
            seconds -= 1;
          }
          setQuotaWait(0);
        }
        if (!response.ok) throw new Error(data.error ?? `No se pudo analizar ${providers[activeProvider].name}.`);
        accumulated = mergeSenderPages(accumulated, data.groups ?? []);
        totalScanned += data.scanned ?? 0;
        pageToken = data.nextPageToken ?? null;
        syncStartHistoryId = data.syncStartHistoryId ?? syncStartHistoryId;
        setSenders(accumulated);
        if (data.email) scannedEmail = data.email;
        if (activeProvider === "gmail") setGmailEmail(data.email ?? "");
        if (activeProvider === "outlook") setOutlookEmail(data.email ?? "");
        setScanned(totalScanned);
        setEstimate(data.resultSizeEstimate ?? totalScanned);
        if (pageToken) await pause(5000, controller.signal);
      } while (pageToken && !controller.signal.aborted);
      completed = !controller.signal.aborted;
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "No se pudo analizar Gmail.");
    } finally {
      if (scanAbortRef.current === controller) {
        if (completed) {
          const completedAt = Date.now();
          setSyncedAt(completedAt);
          providerSnapshotsRef.current[activeProvider] = {
            email: scannedEmail,
            senders: accumulated,
            scanned: totalScanned,
            estimate: accumulated.reduce((total, sender) => total + sender.count, 0),
            scanRange: range,
            customAfter: after,
            customBefore: before,
            syncedAt: completedAt,
          };
        }
        setLoading(false);
        setQuotaWait(0);
        scanAbortRef.current = null;
      }
    }
  }, [provider]);

  const loadCachedRange = useCallback(async (
    range: ScanRange,
    after = "",
    before = "",
  ): Promise<{ coverageComplete: boolean; hasData: boolean }> => {
    const url = new URL(`/api/${mailApiPath(provider)}/index`, window.location.origin);
    url.searchParams.set("range", range);
    if (after) url.searchParams.set("after", after);
    if (before) url.searchParams.set("before", before);
    const response = await fetch(url);
    const data = await response.json() as {
      email?: string;
      groups?: Sender[];
      scanned?: number;
      resultSizeEstimate?: number;
      coverageComplete?: boolean;
      syncedAt?: number | null;
      error?: string;
    };
    if (!response.ok) throw new Error(data.error ?? "No se pudo cargar el índice local.");
    if (provider === "gmail") setGmailEmail(data.email ?? "");
    if (provider === "outlook") setOutlookEmail(data.email ?? "");
    setSenders(data.groups ?? []);
    setScanned(data.scanned ?? 0);
    setEstimate(data.resultSizeEstimate ?? data.scanned ?? 0);
    setSyncedAt(data.syncedAt ?? null);
    setLoading(false);
    if (provider === "gmail" || provider === "outlook") {
      providerSnapshotsRef.current[provider] = {
        email: data.email ?? (provider === "gmail" ? gmailEmail : outlookEmail),
        senders: data.groups ?? [],
        scanned: data.scanned ?? 0,
        estimate: data.resultSizeEstimate ?? data.scanned ?? 0,
        scanRange: range,
        customAfter: after,
        customBefore: before,
        syncedAt: data.syncedAt ?? null,
      };
    }
    return {
      coverageComplete: Boolean(data.coverageComplete),
      hasData: Boolean(data.groups?.length),
    };
  }, [gmailEmail, outlookEmail, provider]);

  const syncMailbox = useCallback(async (): Promise<boolean> => {
    const response = await fetch("/api/google/sync", { method: "POST" });
    const data = await response.json() as {
      needsFullSync?: boolean;
      syncedAt?: number;
      retryAfter?: number;
      error?: string;
    };
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("Mostramos el índice guardado. Gmail pidió una pausa antes de buscar cambios nuevos.");
      }
      throw new Error(data.error ?? "No se pudo sincronizar Gmail.");
    }
    if (data.syncedAt) setSyncedAt(data.syncedAt);
    return Boolean(data.needsFullSync);
  }, []);

  const refreshRange = useCallback(async (
    range: ScanRange,
    after = "",
    before = "",
  ) => {
    setError("");
    setSelected([]);
    setScanRange(range);
    setCustomOpen(range === "custom");
    try {
      if (provider === "outlook") {
        await runScan(range, after, before);
        return;
      }
      const cached = await loadCachedRange(range, after, before);
      if (!cached.coverageComplete) {
        await runScan(range, after, before);
        await loadCachedRange(range, after, before);
        return;
      }
      const needsFullSync = await syncMailbox();
      if (needsFullSync) {
        await runScan(range, after, before);
        await loadCachedRange(range, after, before);
        return;
      }
      await loadCachedRange(range, after, before);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo actualizar Gmail.");
    }
  }, [loadCachedRange, provider, runScan, syncMailbox]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const deferred = window.setTimeout(() => {
      if (params.get("google_error")) setError(`Google: ${params.get("google_error")}`);
      if (params.get("outlook_error")) setError(`Outlook: ${params.get("outlook_error")}`);
      if (params.get("provider") === "gmail") setProvider("gmail");
      if (params.get("provider") === "outlook") setProvider("outlook");
    }, 0);
    return () => window.clearTimeout(deferred);
  }, []);

  useEffect(() => {
    if (provider !== "gmail" && provider !== "outlook") return;
    const deferred = window.setTimeout(() => {
      void (async () => {
        if (restoreProviderSnapshot(provider)) return;
        if (provider === "outlook") {
          try {
            const cached = await loadCachedRange("90d");
            if (cached.hasData) return;
          } catch {
            // The normal refresh below will surface the connection error.
          }
        }
        await refreshRange("90d");
      })();
    }, 0);
    return () => {
      window.clearTimeout(deferred);
      scanAbortRef.current?.abort();
    };
  }, [loadCachedRange, provider, refreshRange, restoreProviderSnapshot]);

  useEffect(() => () => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
  }, []);

  const rows = useMemo(() => senders.filter((sender) => {
    const matchesFilter = filter === "Todos" ||
      (filter === "Dudosos" ? Boolean(sender.doubtful) :
        filter === "Seguros" ? Boolean(sender.safe) : sender.category === filter);
    const matchesQuery = `${sender.name} ${sender.domain}`.toLowerCase().includes(query.toLowerCase());
    return matchesFilter && matchesQuery;
  }), [filter, query, senders]);
  const selectableRows = rows.filter((sender) => !sender.safe);

  const chosen = senders.filter((sender) => selected.includes(sender.id));
  const chosenCount = chosen.reduce((total, sender) => total + sender.count, 0);
  const advertising = senders.filter((sender) => sender.category === "Publicidad").reduce((total, sender) => total + sender.count, 0);
  const available = senders.filter((sender) => sender.unsub).length;

  const chooseProvider = async (key: Provider) => {
    setError("");
    if (key === "icloud") {
      setProvider(key);
      setSenders(demoSenders);
      setScanned(195);
      setEstimate(195);
      return;
    }
    setLoading(true);
    try {
      const apiPath = mailApiPath(key);
      const response = await fetch(`/api/${apiPath}/status`);
      const data = await response.json() as { connected: boolean; configured?: boolean; email?: string; error?: string };
      if (key === "outlook" && data.configured === false) {
        throw new Error("Configura OUTLOOK_CLIENT_ID y OUTLOOK_CLIENT_SECRET para conectar Outlook.");
      }
      if (data.connected) {
        if (key === "gmail") setGmailEmail(data.email ?? "");
        if (key === "outlook") setOutlookEmail(data.email ?? "");
        setProvider(key);
      } else {
        window.location.assign(`/api/${apiPath}/connect`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : key === "outlook" ? "No se pudo iniciar la conexión con Outlook." : "No se pudo iniciar la conexión con Gmail.");
      setLoading(false);
    }
  };

  const disconnect = async () => {
    scanAbortRef.current?.abort();
    if (provider === "gmail" || provider === "outlook") await fetch(`/api/${mailApiPath(provider)}/disconnect`, { method: "POST" });
    setProvider(null);
    setSelected([]);
    setGmailEmail("");
    setOutlookEmail("");
    providerSnapshotsRef.current = {};
    setSenders(demoSenders);
    setView("cleanup");
  };

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const loadSenderMessages = async (
    sender: Sender,
    pageToken: string | null = null,
    append = false,
  ) => {
    setDetailLoading(true);
    setDetailError("");
    try {
      const url = new URL(`/api/${mailApiPath(provider)}/messages`, window.location.origin);
      url.searchParams.set("sender", sender.id);
      url.searchParams.set("range", scanRange);
      if (customAfter) url.searchParams.set("after", customAfter);
      if (customBefore) url.searchParams.set("before", customBefore);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await fetch(url);
      const data = await response.json() as {
        messages?: DetailMessage[];
        nextPageToken?: string | null;
        resultSizeEstimate?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "No se pudieron cargar los correos.");
      setDetailMessages((current) => append ? [...current, ...(data.messages ?? [])] : (data.messages ?? []));
      setDetailPageToken(data.nextPageToken ?? null);
      setDetailEstimate(data.resultSizeEstimate ?? data.messages?.length ?? 0);
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : "No se pudieron cargar los correos.");
    } finally {
      setDetailLoading(false);
    }
  };

  const openSender = (sender: Sender) => {
    if (loading || (provider !== "gmail" && provider !== "outlook")) return;
    setDetailSender(sender);
    setDetailMessages([]);
    setDetailSelected([]);
    setDetailPageToken(null);
    setDetailEstimate(0);
    loadSenderMessages(sender);
  };

  const saveSenderPreference = async (
    sender: Sender,
    category: Category | null,
    safe: boolean,
  ) => {
    if ((provider !== "gmail" && provider !== "outlook") || preferenceBusy) return;
    setPreferenceBusy(sender.id);
    setDetailError("");
    try {
      const response = await fetch(`/api/${mailApiPath(provider)}/preferences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderEmail: sender.id, category, safe }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "No se pudo guardar la preferencia.");

      const detectedCategory = sender.detectedCategory ?? sender.category;
      const corrected = category !== null;
      const nextCategory = safe ? "Notificaciones" : category ?? detectedCategory;
      const nextSender: Sender = {
        ...sender,
        category: nextCategory,
        classificationReason: safe
          ? "Lo marcaste como remitente seguro; nunca se tratará como publicidad."
          : corrected
            ? `Corregiste este remitente como ${category}; recordaremos tu elección.`
            : sender.detectedReason ?? "Volvimos a usar la detección automática.",
        confidence: safe || corrected ? "high" : sender.confidence,
        doubtful: safe || corrected ? false : sender.confidence === "low",
        corrected,
        safe,
      };
      setSenders((current) => current.map((item) => item.id === sender.id ? nextSender : item));
      setDetailSender((current) => current?.id === sender.id ? nextSender : current);
      if (provider === "gmail" || provider === "outlook") delete providerSnapshotsRef.current[provider];
      if (safe) setSelected((current) => current.filter((id) => id !== sender.id));
      showNotice(safe
        ? `${sender.name} se añadió a remitentes seguros.`
        : corrected
          ? `Recordaremos que ${sender.name} es ${category}.`
          : `Se restauró la detección automática para ${sender.name}.`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "No se pudo guardar la preferencia.";
      if (detailSender?.id === sender.id) setDetailError(message);
      else setError(message);
    } finally {
      setPreferenceBusy(null);
    }
  };

  const toggleDetail = (id: string) => {
    setDetailSelected((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  };

  const actDetail = async (action: "unsubscribe" | "trash") => {
    if (!detailSender || busy) return;
    if (action === "trash" && !detailSelected.length) {
      setDetailError("Selecciona al menos un correo.");
      return;
    }
    const undoSnapshot: UndoState = {
      groups: [],
      senders,
      detailMessages,
      detailSender,
    };
    setBusy(true);
    setDetailError("");
    try {
      const response = await fetch(`/api/${mailApiPath(provider)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          range: scanRange,
          after: customAfter,
          before: customBefore,
          groups: [{
            id: detailSender.id,
            name: detailSender.name,
            domain: detailSender.domain,
            primaryMessageId: detailSender.primaryMessageId,
            messageIds: action === "trash" ? detailSelected : undefined,
          }],
        }),
      });
      const data = await response.json() as {
        unsubscribed?: number;
        manual?: number;
        trashed?: number;
        trashedGroups?: TrashGroup[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "No se pudo completar la acción.");
      if (provider === "gmail" || provider === "outlook") delete providerSnapshotsRef.current[provider];
      if (action === "trash") {
        const removed = new Set(detailSelected);
        setDetailMessages((current) => current.filter((message) => !removed.has(message.id)));
        setSenders((current) => current
          .map((sender) => sender.id === detailSender.id
            ? { ...sender, count: Math.max(0, sender.count - detailSelected.length) }
            : sender)
          .filter((sender) => sender.count > 0));
        if (data.trashedGroups?.length) {
          setUndoState({ ...undoSnapshot, groups: data.trashedGroups });
        }
        showNotice(
          `${data.trashed ?? 0} correos seleccionados enviados a la papelera.`,
          data.trashedGroups?.length ? 12_000 : 4200,
        );
        setDetailSelected([]);
      } else {
        showNotice(data.unsubscribed
          ? "El remitente aceptó la solicitud de desuscripción."
          : "La desuscripción requiere revisión manual. Abre el enlace desde Historial.");
      }
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  };

  const loadHistory = async (refresh = false) => {
    if (provider !== "gmail" && provider !== "outlook") {
      setHistory([]);
      setView("history");
      return;
    }
    setView("history");
    setHistoryLoading(true);
    setError("");
    try {
      if (refresh) {
        if (provider === "outlook") {
          await runScan(scanRange, customAfter, customBefore);
        } else {
          const needsFullSync = await syncMailbox();
          if (needsFullSync) {
            await runScan(scanRange, customAfter, customBefore);
          } else {
            await loadCachedRange(scanRange, customAfter, customBefore);
          }
        }
      }
      const response = await fetch(`/api/${mailApiPath(provider)}/history`);
      const data = await response.json() as { history?: HistoryRecord[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "No se pudo cargar el historial.");
      setHistory(data.history ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo cargar el historial.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const act = async (action: "unsubscribe" | "unsubscribe_and_trash") => {
    if (!selected.length || busy) return;
    if (provider === "icloud") {
      showNotice(action === "unsubscribe" ? "Vista de iCloud preparada para la integración." : `${chosenCount} mensajes se moverían a la papelera.`);
      setSelected([]);
      return;
    }
    const undoSnapshot: UndoState = {
      groups: [],
      senders,
      detailMessages,
      detailSender,
    };
    setBusy(true);
    setError("");
    const totals = { unsubscribed: 0, manual: 0, trashed: 0 };
    const trashedGroups: TrashGroup[] = [];
    const processedSenderIds: string[] = [];
    try {
      for (let index = 0; index < chosen.length; index += 20) {
        const batch = chosen.slice(index, index + 20);
        const response = await fetch(`/api/${mailApiPath(provider)}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            range: scanRange,
            after: customAfter,
            before: customBefore,
            groups: batch.map(({ id, name, domain, primaryMessageId }) => ({
              id,
              name,
              domain,
              primaryMessageId,
            })),
          }),
        });
        const data = await response.json() as { unsubscribed?: number; manual?: number; trashed?: number; trashedGroups?: TrashGroup[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "No se pudo completar la acción.");
        totals.unsubscribed += data.unsubscribed ?? 0;
        totals.manual += data.manual ?? 0;
        totals.trashed += data.trashed ?? 0;
        trashedGroups.push(...(data.trashedGroups ?? []));
        processedSenderIds.push(...batch.map((sender) => sender.id));
      }
      if (action === "unsubscribe_and_trash" && trashedGroups.length) {
        setUndoState({ ...undoSnapshot, groups: trashedGroups });
      }
      showNotice(
        `${totals.unsubscribed} desuscripciones completadas · ${totals.trashed} mensajes a la papelera${totals.manual ? ` · ${totals.manual} requieren revisión manual; abre sus enlaces en Historial` : ""}`,
        action === "unsubscribe_and_trash" && trashedGroups.length ? 12_000 : 4200,
      );
      if (action === "unsubscribe_and_trash") {
        setSenders((current) => current.filter((sender) => !selected.includes(sender.id)));
      }
      if (provider === "gmail" || provider === "outlook") delete providerSnapshotsRef.current[provider];
      setSelected([]);
    } catch (reason) {
      if (processedSenderIds.length) {
        const processed = new Set(processedSenderIds);
        if (action === "unsubscribe_and_trash") {
          setSenders((current) => current.filter((sender) => !processed.has(sender.id)));
          if (trashedGroups.length) setUndoState({ ...undoSnapshot, groups: trashedGroups });
        }
        setSelected((current) => current.filter((id) => !processed.has(id)));
        showNotice(
          `Se completaron ${processed.size} remitentes antes de la interrupción.`,
          trashedGroups.length ? 12_000 : 4200,
        );
      }
      setError(reason instanceof Error ? reason.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  };

  const undoTrash = async () => {
    if (!undoState || busy) return;
    const snapshot = undoState;
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    const expected = snapshot.groups.reduce(
      (total, group) => total + group.messageIds.length,
      0,
    );
    setBusy(true);
    try {
      let restored = 0;
      for (let index = 0; index < snapshot.groups.length; index += 20) {
        const response = await fetch(`/api/${mailApiPath(provider)}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "restore",
            groups: snapshot.groups.slice(index, index + 20),
          }),
        });
        const data = await response.json() as { restored?: number; error?: string };
        if (!response.ok) throw new Error(data.error ?? "No se pudieron restaurar los correos.");
        restored += data.restored ?? 0;
      }
      if (restored < expected) {
        throw new Error(`Gmail solo pudo restaurar ${restored} de ${expected} correos.`);
      }
      setSenders(snapshot.senders);
      if (provider === "gmail" || provider === "outlook") delete providerSnapshotsRef.current[provider];
      setDetailMessages(snapshot.detailMessages);
      setDetailSender(snapshot.detailSender);
      setDetailSelected([]);
      setSelected([]);
      setUndoState(null);
      showNotice(`${restored} correos restaurados en la bandeja de entrada.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudieron restaurar los correos.");
      showNotice("No se pudo deshacer todavía. Puedes volver a intentarlo.", 12_000);
    } finally {
      setBusy(false);
    }
  };

  const confirmPendingAction = () => {
    if (!pendingAction || busy) return;
    const request = pendingAction;
    setPendingAction(null);
    if (request.scope === "bulk") void act(request.action);
    else void actDetail(request.action);
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
          {error && <div className="error-banner">{error}</div>}
          <div className="provider-grid">
            {(Object.keys(providers) as Provider[]).map((key) => {
              const item = providers[key];
              return (
                <button
                  key={key}
                  className={`provider-card ${item.tone}`}
                  onClick={() => chooseProvider(key)}
                  disabled={loading || key === "icloud"}
                  aria-disabled={key === "icloud"}
                  title={key === "icloud" ? "iCloud estará disponible cuando se configure su integración." : undefined}
                >
                  <span className="provider-logo">{item.mark}</span>
                  <span><strong>{key === "icloud" ? "iCloud (próximamente)" : loading ? "Conectando..." : `Continuar con ${item.name}`}</strong><small>{key === "icloud" ? "Integración no configurada todavía" : "Conectar cuenta real de forma segura"}</small></span>
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
  const accountEmail = provider === "gmail" && gmailEmail ? gmailEmail : provider === "outlook" && outlookEmail ? outlookEmail : account.email;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-icon"><Icon name="shield" /></span>Spam<span>Kill</span></div>
        <div className="account-card">
          <span className={`account-mark ${account.tone}`}>{account.mark}</span>
          <span><strong>{account.name}</strong><small>{accountEmail}</small></span>
          <button aria-label="Cambiar cuenta" onClick={() => { setProvider(null); setSelected([]); }}><Icon name="chevron" /></button>
        </div>
        <nav className="side-nav">
          <button className={view === "cleanup" ? "active" : ""} onClick={() => setView("cleanup")}><Icon name="spark" /> Limpieza inteligente <b>{senders.length}</b></button>
          <button className={view === "history" ? "active" : ""} onClick={() => loadHistory(false)}><Icon name="history" /> Historial</button>
          <button><Icon name="settings" /> Configuración</button>
        </nav>
        <div className="privacy-note">
          <span><Icon name="shield" /></span>
          <strong>Privacidad primero</strong>
          <p>Analizamos encabezados y contenido necesario para detectar suscripciones.</p>
        </div>
        <button className="disconnect" onClick={disconnect}><Icon name="logout" /> Desconectar cuenta</button>
      </aside>

      {view === "history" ? (
        <HistoryView records={history} loading={historyLoading} providerName={account.name} onRefresh={() => loadHistory(true)} />
      ) : (
      <main className="dashboard">
        <header className="dash-header">
          <div>
            <p className="breadcrumb">{account.name} / Limpieza</p>
            <h1>{loading ? "Analizando tu bandeja..." : "Tu bandeja, bajo control."}</h1>
            <p>{loading ? <>Procesados <strong>{scanned}</strong>{estimate ? ` de aproximadamente ${estimate}` : ""}. Puedes detener el análisis cuando quieras.</> : <>Encontramos <strong>{senders.reduce((total, sender) => total + sender.count, 0)} mensajes</strong> de {senders.length} remitentes para revisar.{syncedAt ? ` Índice actualizado a las ${new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(new Date(syncedAt))}.` : ""}</>}</p>
          </div>
          <div className="safety"><span>●</span><div><strong>Modo seguro activo</strong><small>Los correos irán a la papelera</small></div></div>
        </header>

        {error && <div className="error-banner dashboard-error">{error}</div>}
        <section className="stats">
          <article><span className="stat-icon violet"><Icon name="spark" /></span><div><small>Mensajes analizados</small><strong>{scanned}</strong><em>{rangeLabels[scanRange]}</em></div></article>
          <article><span className="stat-icon orange">%</span><div><small>Publicidad</small><strong>{advertising}</strong><em>Detección inicial</em></div></article>
          <article><span className="stat-icon green"><Icon name="ban" /></span><div><small>Desuscripción disponible</small><strong>{available}</strong><em>De {senders.length} remitentes</em></div></article>
        </section>

        <section className="scope-panel">
          <div>
            <small>Periodo del análisis</small>
            <strong>Elige qué parte de {account.name} quieres revisar</strong>
          </div>
          <div className="scope-options">
            {(["all", "30d", "90d", "1y"] as ScanRange[]).map((range) => (
              <button
                key={range}
                className={scanRange === range ? "active" : ""}
                disabled={loading}
                onClick={() => refreshRange(range)}
              >
                {rangeLabels[range]}
              </button>
            ))}
            <button
              className={customOpen ? "active" : ""}
              disabled={loading}
              onClick={() => setCustomOpen(true)}
            >
              Por fechas
            </button>
          </div>
          {customOpen && (
            <div className="custom-dates">
              <label>Desde<input type="date" value={customAfter} onChange={(event) => setCustomAfter(event.target.value)} /></label>
              <label>Hasta<input type="date" value={customBefore} onChange={(event) => setCustomBefore(event.target.value)} /></label>
              <button disabled={loading || !customAfter || !customBefore} onClick={() => refreshRange("custom", customAfter, customBefore)}>Analizar fechas</button>
            </div>
          )}
          {loading && (
            <div className="scan-progress">
              <span><i style={{ width: estimate ? `${Math.min(100, Math.round((scanned / estimate) * 100))}%` : "12%" }} /></span>
              <small>{quotaWait && provider === "gmail" ? `Gmail pidió una pausa: reintentando en ${quotaWait}s` : "Análisis pausado entre páginas para proteger la cuota"}</small>
              <button onClick={() => scanAbortRef.current?.abort()}>Detener análisis</button>
            </div>
          )}
        </section>

        <section className="mail-panel">
          <div className="toolbar">
            <div className="filters">
              {(["Todos", "Publicidad", "Newsletters", "Notificaciones", "Dudosos", "Seguros"] as Filter[]).map((item) => (
                <button key={item} onClick={() => setFilter(item)} className={filter === item ? "active" : ""}>
                  {item}{item === "Dudosos" ? ` (${senders.filter((sender) => sender.doubtful).length})` : item === "Seguros" ? ` (${senders.filter((sender) => sender.safe).length})` : ""}
                </button>
              ))}
            </div>
            <label className="search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar remitente..." /></label>
          </div>

          <div className="table-head">
            <label><input type="checkbox" checked={selectableRows.length > 0 && selectableRows.every((row) => selected.includes(row.id))} onChange={() => setSelected(selectableRows.every((row) => selected.includes(row.id)) ? [] : selectableRows.map((row) => row.id))} /> Remitente</label>
            <span>Categoría</span><span>Mensajes</span><span>Último</span><span>Desuscripción</span>
          </div>

          <div className="sender-list">
            {loading && <div className="loading-state"><span className="loader" /> Analizando {rangeLabels[scanRange].toLowerCase()}...</div>}
            {!loading && rows.length === 0 && <div className="empty-state">No encontramos remitentes con estos filtros.</div>}
            {!loading && rows.map((sender) => (
              <div className={`sender-row ${selected.includes(sender.id) ? "selected" : ""}`} key={sender.id}>
                <span className="sender-main">
                  <input aria-label={`Seleccionar ${sender.name}`} title={sender.safe ? "Remitente protegido por la lista segura" : undefined} type="checkbox" disabled={sender.safe} checked={selected.includes(sender.id)} onChange={() => toggle(sender.id)} />
                  <button className="sender-open" onClick={() => openSender(sender)}>
                    <i style={{ background: sender.color }}>{sender.initials}</i>
                    <span><strong>{sender.name}</strong><small>{sender.domain} · Ver correos</small></span>
                  </button>
                </span>
                <span className="category-control">
                  <select
                    aria-label={`Categoría de ${sender.name}`}
                    className={`category-select ${sender.category.toLowerCase()}`}
                    value={sender.category}
                    disabled={(provider !== "gmail" && provider !== "outlook") || preferenceBusy === sender.id}
                    onChange={(event) => void saveSenderPreference(sender, event.target.value as Category, false)}
                  >
                    {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                  <small className={sender.doubtful ? "needs-review" : ""}>
                    {sender.safe ? "Seguro" : sender.corrected ? "Corregida por ti" : sender.doubtful ? "Revisar" : "Automática"}
                  </small>
                </span>
                <strong className="message-count">{sender.count}</strong>
                <span className="last-date">{sender.last}</span>
                <span className={sender.unsub ? "available" : "manual"}>{sender.unsub ? "✓ Disponible" : "Manual"}</span>
              </div>
            ))}
          </div>

          {selected.length > 0 && (
            <div className="action-bar">
              <div><strong>{selected.length} remitentes seleccionados</strong><small>{chosenCount} mensajes afectados</small></div>
              <button disabled={busy} className="unsubscribe" onClick={() => setPendingAction({ scope: "bulk", action: "unsubscribe" })}><Icon name="ban" /> {busy ? "Procesando..." : "Desuscribir"}</button>
              <button disabled={busy} className="delete" onClick={() => setPendingAction({ scope: "bulk", action: "unsubscribe_and_trash" })}><Icon name="trash" /> Desuscribir y limpiar</button>
            </div>
          )}
        </section>
        <p className="footer-copy">SpamKill nunca elimina mensajes de forma permanente sin tu confirmación.</p>
      </main>
      )}
      {detailSender && (
        <div className="drawer-backdrop" onMouseDown={() => setDetailSender(null)}>
          <aside className="sender-drawer" onMouseDown={(event) => event.stopPropagation()}>
            <header className="drawer-header">
              <div>
                <span className="drawer-avatar" style={{ background: detailSender.color }}>{detailSender.initials}</span>
                <span><small>Correos de</small><strong>{detailSender.name}</strong><em>{detailEstimate || detailSender.count} mensajes en {rangeLabels[scanRange].toLowerCase()}</em></span>
              </div>
              <button aria-label="Cerrar detalle" onClick={() => setDetailSender(null)}>×</button>
            </header>
            <section className="classification-review">
              <div className="classification-title">
                <span>
                  <small>Por qué aparece como</small>
                  <strong>{detailSender.category}</strong>
                </span>
                <b className={detailSender.doubtful ? "confidence-low" : "confidence-ok"}>
                  {detailSender.safe ? "Remitente seguro" : detailSender.corrected ? "Corregida por ti" : detailSender.doubtful ? "Clasificación dudosa" : `Confianza ${detailSender.confidence === "medium" ? "media" : "alta"}`}
                </b>
              </div>
              <p>{detailSender.classificationReason ?? "Clasificación automática basada en las señales disponibles."}</p>
              <div className="classification-actions">
                <span>Corregir:</span>
                {categoryOptions.map((category) => (
                  <button
                    key={category}
                    className={detailSender.category === category && !detailSender.safe ? "active" : ""}
                    disabled={preferenceBusy === detailSender.id}
                    onClick={() => void saveSenderPreference(detailSender, category, false)}
                  >
                    {category}
                  </button>
                ))}
                <button
                  className={`safe-toggle ${detailSender.safe ? "active" : ""}`}
                  disabled={preferenceBusy === detailSender.id}
                  onClick={() => void saveSenderPreference(
                    detailSender,
                    detailSender.corrected ? detailSender.category : null,
                    !detailSender.safe,
                  )}
                >
                  {detailSender.safe ? "✓ Seguro" : "Marcar seguro"}
                </button>
                {(detailSender.corrected || detailSender.safe) && (
                  <button
                    className="reset-classification"
                    disabled={preferenceBusy === detailSender.id}
                    onClick={() => void saveSenderPreference(detailSender, null, false)}
                  >
                    Usar detección automática
                  </button>
                )}
              </div>
            </section>
            <div className="drawer-toolbar">
              <label>
                <input
                  type="checkbox"
                  checked={detailMessages.length > 0 && detailMessages.every((message) => detailSelected.includes(message.id))}
                  onChange={() => setDetailSelected(
                    detailMessages.every((message) => detailSelected.includes(message.id))
                      ? []
                      : detailMessages.map((message) => message.id),
                  )}
                />
                Seleccionar los {detailMessages.length} cargados
              </label>
              <span>{detailSelected.length} seleccionados</span>
            </div>
            {detailError && <div className="drawer-error">{detailError}</div>}
            <div className="message-list">
              {detailMessages.map((message) => (
                <label className={`message-row ${detailSelected.includes(message.id) ? "selected" : ""}`} key={message.id}>
                  <input type="checkbox" checked={detailSelected.includes(message.id)} onChange={() => toggleDetail(message.id)} />
                  <span>
                    <strong>{message.subject}</strong>
                    <small>{message.snippet || "Sin vista previa disponible."}</small>
                    <em>{new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" }).format(new Date(message.receivedAt))}{message.hasUnsubscribe ? " · Admite desuscripción" : ""}</em>
                  </span>
                </label>
              ))}
              {detailLoading && <div className="drawer-loading"><span className="loader" /> Cargando correos...</div>}
              {!detailLoading && !detailMessages.length && !detailError && <div className="empty-state">No encontramos correos en este periodo.</div>}
              {detailPageToken && !detailLoading && (
                <button className="load-more" onClick={() => loadSenderMessages(detailSender, detailPageToken, true)}>Cargar 50 más</button>
              )}
            </div>
            <footer className="drawer-actions">
              <button className="drawer-unsubscribe" disabled={busy} onClick={() => setPendingAction({ scope: "detail", action: "unsubscribe" })}><Icon name="ban" /> Desuscribir remitente</button>
              <button className="drawer-trash" disabled={busy || !detailSelected.length} onClick={() => setPendingAction({ scope: "detail", action: "trash" })}><Icon name="trash" /> Mover seleccionados ({detailSelected.length})</button>
            </footer>
          </aside>
        </div>
      )}
      {pendingAction && (
        <div className="confirm-backdrop" onMouseDown={() => !busy && setPendingAction(null)}>
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="confirm-icon"><Icon name={pendingAction.action === "unsubscribe" ? "ban" : "trash"} /></span>
            <h2 id="confirm-title">
              {pendingAction.action === "unsubscribe"
                ? "¿Desuscribir este contenido?"
                : "¿Mover estos correos a la papelera?"}
            </h2>
            <p>
              {pendingAction.scope === "bulk"
                ? `${selected.length} remitentes y ${chosenCount} mensajes están seleccionados.`
                : pendingAction.action === "trash"
                  ? `${detailSelected.length} correos de ${detailSender?.name ?? "este remitente"} están seleccionados.`
                  : `Se solicitará la desuscripción de ${detailSender?.name ?? "este remitente"}.`}
            </p>
            <div className="confirm-note">
              {pendingAction.action === "unsubscribe"
                ? "La solicitud de desuscripción no puede deshacerse."
                : pendingAction.action === "unsubscribe_and_trash"
                  ? "Podrás restaurar los correos durante unos segundos; la desuscripción no puede deshacerse."
                  : "Nada se eliminará permanentemente y podrás deshacer esta acción durante unos segundos."}
            </div>
            <div className="confirm-actions">
              <button className="confirm-cancel" disabled={busy} onClick={() => setPendingAction(null)}>Cancelar</button>
              <button className="confirm-accept" disabled={busy} onClick={confirmPendingAction}>
                {pendingAction.action === "unsubscribe" ? "Sí, desuscribir" : "Confirmar y mover"}
              </button>
            </div>
          </section>
        </div>
      )}
      {notice && (
        <div className={`toast ${undoState ? "with-undo" : ""}`}>
          <span>✓ {notice}</span>
          {undoState && <button disabled={busy} onClick={() => void undoTrash()}>{busy ? "Restaurando..." : "Deshacer"}</button>}
        </div>
      )}
    </div>
  );
}

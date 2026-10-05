"use client";

import React, { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./AiAssistantView.css";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

interface BudgetData {
  period: {
    monthly_limit: number;
    committed_amount: number;
    consumed_amount: number;
    available_amount: number;
    status: string;
    currency: string;
  };
  departmentBudgets: Array<{
    department_id: string;
    allocated_amount: number;
    consumed_amount: number;
    available_amount: number;
  }>;
}

interface WorkforceData {
  totalAgents: number;
  activeAgents: number;
  agents: Array<{
    id: string;
    name: string;
    role: string;
    department: string;
    level: string;
    status: string;
    tasks_completed?: number;
    last_used_at?: string | null;
  }>;
}

interface MemoryData {
  count: number;
  memories: Array<{
    id: string;
    memory_type: string;
    scope_type: string;
    scope_id: string;
    title: string;
    content: string;
    authority_level: string;
    status: string;
  }>;
}

interface CapabilityData {
  count: number;
  capabilities: Array<any>;
}

interface ToolData {
  count: number;
  tools: Array<any>;
}

interface DataSourceData {
  count: number;
  dataSources: Array<any>;
}

// Owner counts as "at the bottom" within this distance; beyond it we preserve position.
const NEAR_BOTTOM_THRESHOLD_PX = 80;

export function AiAssistantView({ fullScreen = false }: { fullScreen?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [budgetData, setBudgetData] = useState<BudgetData | null>(null);
  const [workforceData, setWorkforceData] = useState<WorkforceData | null>(null);
  const [memoryData, setMemoryData] = useState<MemoryData | null>(null);
  const [capabilityData, setCapabilityData] = useState<CapabilityData | null>(null);
  const [toolData, setToolData] = useState<ToolData | null>(null);
  const [dataSourceData, setDataSourceData] = useState<DataSourceData | null>(null);

  const [activeRightDrawer, setActiveRightDrawer] = useState<string | null>(null);
  const [runTraceData, setRunTraceData] = useState<any>(null);
  const [tasksData, setTasksData] = useState<any>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({});
  const [recentConversations, setRecentConversations] = useState<any[]>([]);
  // Chat Bin (soft delete)
  const [binnedConversations, setBinnedConversations] = useState<any[]>([]);
  const [sidebarView, setSidebarView] = useState<"recent" | "bin">("recent");
  const [convMenu, setConvMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [confirmBin, setConfirmBin] = useState<{ id: string; title: string } | null>(null);
  const [binBusy, setBinBusy] = useState(false);
  // Permanent delete (Bin only): impact dialog + explicit acknowledgement before any mutation.
  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    title: string;
    impact: { messageCount: number; runCount: number; taskCount: number; otherLinkedRecordCount: number; fingerprint: string } | null;
    error?: string;
  } | null>(null);
  const [deleteAck, setDeleteAck] = useState(false);
  // Bulk management: Move All / Restore All / Delete All Permanently (Bin only).
  const [bulkDlg, setBulkDlg] = useState<{
    kind: "MOVE_ALL" | "RESTORE_ALL" | "DELETE_ALL";
    impact: { counts: { conversations: number; messages: number; runs: number; tasks: number }; otherScopedRows: number; fingerprint: string } | null;
    error?: string;
  } | null>(null);
  const [bulkAck, setBulkAck] = useState(false);
  const [bulkPhrase, setBulkPhrase] = useState("");
  // Set when a direct URL points to a conversation that does not exist (e.g. permanently deleted).
  const [notFoundId, setNotFoundId] = useState<string | null>(null);
  // Set when the open conversation (e.g. via direct URL) is in the Bin.
  const [binnedInfo, setBinnedInfo] = useState<{ id: string; title: string; binned_at: string | null } | null>(null);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  // Conversation whose messages we most recently requested; stale responses are dropped.
  const requestedConversationIdRef = useRef<string | null>(null);
  const prevMessagesLengthRef = useRef(0);
  const prevConversationIdRef = useRef<string | null>(null);

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    isNearBottomRef.current = distanceFromBottom < NEAR_BOTTOM_THRESHOLD_PX;
  };

  /**
   * Single scroll helper for the chat. Scrolls ONLY the .ai-messages container
   * (never window/body or the workspace), so the composer and sidebar never move.
   */
  const scrollChatToBottom = (mode: "instant" | "smooth" = "instant") => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const top = container.scrollHeight;
    if (mode === "smooth" && typeof container.scrollTo === "function") {
      container.scrollTo({ top, behavior: "smooth" });
    } else {
      container.scrollTop = top;
    }
    isNearBottomRef.current = true;
  };

  const fetchRecentConversations = async () => {
    try {
      const res = await fetch("/api/ai/conversations?state=active");
      if (res.ok) setRecentConversations(await res.json());
    } catch {}
  };

  const fetchBinnedConversations = async () => {
    try {
      const res = await fetch("/api/ai/conversations?state=binned");
      if (res.ok) setBinnedConversations(await res.json());
    } catch {}
  };

  const resetToNewChat = () => {
    setNotFoundId(null);
    setMessages([]);
    setConversationId(null);
    setBinnedInfo(null);
    setRunTraceData(null);
    setTasksData(null);
    setActiveRunId(null);
    window.history.pushState({}, "", "/ai-ceo");
  };

  const openActiveConversation = (id: string) => {
    setBinnedInfo(null);
    setConversationId(id);
    setMessages([]);
    setRunTraceData(null);
    setTasksData(null);
    setActiveRunId(null);
    fetchMessagesForConversation(id);
    fetchRunTrace("latest", id);
    isNearBottomRef.current = true;
    window.history.pushState({}, "", `/ai-ceo?conversation=${id}`);
  };

  // Opening a binned conversation never loads it as if it were active.
  const openBinnedConversation = (c: { id: string; title: string; binned_at: string | null }) => {
    requestedConversationIdRef.current = c.id;
    setConversationId(c.id);
    setMessages([]);
    setRunTraceData(null);
    setTasksData(null);
    setActiveRunId(null);
    setBinnedInfo({ id: c.id, title: c.title, binned_at: c.binned_at });
    window.history.pushState({}, "", `/ai-ceo?conversation=${c.id}`);
  };

  const postBinAction = async (id: string, action: "MOVE_TO_BIN" | "RESTORE") => {
    const res = await fetch(`/api/ai/conversations/${id}/state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    return res.ok;
  };

  const handleMoveToBin = async (id: string) => {
    if (binBusy) return;
    setBinBusy(true);
    try {
      const ok = await postBinAction(id, "MOVE_TO_BIN");
      setConfirmBin(null);
      if (ok) {
        if (id === conversationId) resetToNewChat();
        await Promise.all([fetchRecentConversations(), fetchBinnedConversations()]);
      }
    } finally {
      setBinBusy(false);
    }
  };

  const openDeleteDialog = async (c: { id: string; title: string }) => {
    setDeleteAck(false);
    setConfirmDelete({ id: c.id, title: c.title, impact: null });
    try {
      const res = await fetch(`/api/ai/conversations/${c.id}/impact`);
      if (res.ok) {
        const impact = await res.json();
        setConfirmDelete(prev => (prev && prev.id === c.id ? { ...prev, impact } : prev));
      } else {
        setConfirmDelete(prev => (prev && prev.id === c.id ? { ...prev, error: "Could not load impact preview." } : prev));
      }
    } catch {
      setConfirmDelete(prev => (prev && prev.id === c.id ? { ...prev, error: "Could not load impact preview." } : prev));
    }
  };

  const handleDeletePermanently = async (id: string) => {
    if (binBusy || !deleteAck || !confirmDelete?.impact?.fingerprint) return;
    setBinBusy(true);
    try {
      const res = await fetch(`/api/ai/conversations/${id}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DELETE_PERMANENTLY", confirm: true, conversationId: id, previewFingerprint: confirmDelete.impact.fingerprint }),
      });
      if (res.ok) {
        setConfirmDelete(null);
        setDeleteAck(false);
        if (id === conversationId) resetToNewChat();
        await Promise.all([fetchRecentConversations(), fetchBinnedConversations()]);
      } else {
        const body = await res.json().catch(() => ({}));
        if (body?.code === "STALE_PREVIEW" || body?.code === "FINGERPRINT_CHANGED") {
          // Never retry a destructive action automatically: reload the read-only preview and require a fresh acknowledgement.
          setDeleteAck(false);
          setConfirmDelete(prev => (prev ? { ...prev, impact: null, error: "Conversation changed. Please review the impact again." } : prev));
          try {
            const r2 = await fetch(`/api/ai/conversations/${id}/impact`);
            if (r2.ok) {
              const impact = await r2.json();
              setConfirmDelete(prev => (prev && prev.id === id ? { ...prev, impact, error: "Conversation changed. Please review the impact again." } : prev));
            }
          } catch {}
          await Promise.all([fetchRecentConversations(), fetchBinnedConversations()]);
        } else {
          setConfirmDelete(prev => (prev ? { ...prev, error: body?.error || "Permanent delete failed. Nothing was deleted." } : prev));
        }
      }
    } finally {
      setBinBusy(false);
    }
  };

  const openBulkDialog = async (kind: "MOVE_ALL" | "RESTORE_ALL" | "DELETE_ALL") => {
    if (binBusy) return;
    setBulkAck(false);
    setBulkPhrase("");
    setBulkDlg({ kind, impact: null });
    const scope = kind === "MOVE_ALL" ? "active" : "binned";
    try {
      const res = await fetch(`/api/ai/conversation-bulk?scope=${scope}`);
      if (res.ok) {
        const impact = await res.json();
        setBulkDlg(prev => (prev && prev.kind === kind ? { ...prev, impact } : prev));
      } else {
        setBulkDlg(prev => (prev && prev.kind === kind ? { ...prev, error: "Could not load impact preview." } : prev));
      }
    } catch {
      setBulkDlg(prev => (prev && prev.kind === kind ? { ...prev, error: "Could not load impact preview." } : prev));
    }
  };

  const closeBulkDialog = () => {
    if (binBusy) return;
    setBulkDlg(null);
    setBulkAck(false);
    setBulkPhrase("");
  };

  const handleBulkConfirm = async () => {
    if (!bulkDlg || !bulkDlg.impact || binBusy) return;
    const kind = bulkDlg.kind;
    if (kind === "DELETE_ALL" && (!bulkAck || bulkPhrase !== "DELETE ALL")) return;
    setBinBusy(true);
    try {
      const body: any =
        kind === "MOVE_ALL" ? { action: "MOVE_ALL_TO_BIN" }
        : kind === "RESTORE_ALL" ? { action: "RESTORE_ALL" }
        : { action: "DELETE_ALL_PERMANENTLY", confirm: true, typedConfirmation: bulkPhrase, expectedFingerprint: bulkDlg.impact.fingerprint };
      const res = await fetch("/api/ai/conversation-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const openIsBinned = !!conversationId && binnedConversations.some(c => c.id === conversationId);
        const openIsActive = !!conversationId && recentConversations.some(c => c.id === conversationId);
        setBulkDlg(null);
        setBulkAck(false);
        setBulkPhrase("");
        if ((kind === "MOVE_ALL" && openIsActive) || (kind === "DELETE_ALL" && openIsBinned)) resetToNewChat();
        await Promise.all([fetchRecentConversations(), fetchBinnedConversations()]);
        if (kind === "RESTORE_ALL" && binnedInfo) openActiveConversation(binnedInfo.id);
      } else {
        const j = await res.json().catch(() => ({}));
        setBulkDlg(prev => (prev ? { ...prev, error: j?.error || "Bulk action failed. Nothing was changed." } : prev));
        await Promise.all([fetchRecentConversations(), fetchBinnedConversations()]);
      }
    } finally {
      setBinBusy(false);
    }
  };

  const handleRestore = async (id: string) => {
    if (binBusy) return;
    setBinBusy(true);
    try {
      const ok = await postBinAction(id, "RESTORE");
      if (ok) {
        await Promise.all([fetchRecentConversations(), fetchBinnedConversations()]);
        // If the restored conversation is the one on screen, load it normally now.
        if (binnedInfo?.id === id) openActiveConversation(id);
      }
    } finally {
      setBinBusy(false);
    }
  };

  const fetchMessagesForConversation = async (id: string) => {
    requestedConversationIdRef.current = id;
    try {
      const res = await fetch(`/api/ai/conversations/${id}/messages`);
      if (res.ok) {
        const data = await res.json();
        // Ignore a late response for a conversation the Owner has already left.
        if (requestedConversationIdRef.current !== id) return;
        setMessages(data);
      }
    } catch {}
  };

  const fetchBudgetAndWorkforce = async () => {
    try {
      const [bRes, wRes, mRes, cRes, tRes, dRes] = await Promise.all([
        fetch("/api/ai/budget"),
        fetch("/api/ai/workforce"),
        fetch("/api/ai/memory"),
        fetch("/api/ai/capabilities"),
        fetch("/api/ai/tools"),
        fetch("/api/ai/data-sources"),
      ]);
      if (bRes.ok) setBudgetData(await bRes.json());
      if (wRes.ok) setWorkforceData(await wRes.json());
      if (mRes.ok) setMemoryData(await mRes.json());
      if (cRes.ok) setCapabilityData(await cRes.json());
      if (tRes.ok) setToolData(await tRes.json());
      if (dRes.ok) setDataSourceData(await dRes.json());
    } catch {
      // Ignore background fetch error
    }
  };

  const fetchRunTrace = async (runId: string, explicitConvId?: string | null) => {
    try {
      const isLatest = runId === "latest";
      let url = isLatest ? `/api/ai/runs/latest` : `/api/ai/runs/${runId}`;

      const cid = explicitConvId !== undefined ? explicitConvId : conversationId;
      if (isLatest && cid) {
        url += `?conversationId=${cid}`;
      }

      const rRes = await fetch(url);

      if (rRes.ok) {
        const rData = await rRes.json();
        setRunTraceData(rData);
        if (rData.run) {
           const actualRunId = rData.run.id;
           const tRes = await fetch(`/api/ai/runs/${actualRunId}/tasks`);
           if (tRes.ok) setTasksData(await tRes.json());
           setActiveRunId(actualRunId);
        }
      } else {
        if (isLatest) {
          setRunTraceData(null);
          setTasksData(null);
          setActiveRunId(null);
        }
      }
    } catch {
      // Ignore background fetch error
    }
  };

  useEffect(() => {
    fetchBudgetAndWorkforce();
    fetchRecentConversations();
    fetchBinnedConversations();

    // Read conversation ID from URL parameters
    const searchParams = new URLSearchParams(window.location.search);
    const convId = searchParams.get('conversation');

    if (convId) {
      setConversationId(convId);
      // Tell the truth about a binned conversation: do not load it as active.
      fetch(`/api/ai/conversations/${convId}`)
        .then(async r => (r.status === 404 ? { __notFound: true } : r.ok ? await r.json() : null))
        .then((meta: any) => {
          if (meta && meta.__notFound) {
            // Truthful: never fall through to an empty "active" chat that would recreate the id.
            requestedConversationIdRef.current = null;
            setConversationId(null);
            setNotFoundId(convId);
          } else if (meta && meta.status === "BINNED") {
            requestedConversationIdRef.current = convId;
            setBinnedInfo({ id: meta.id, title: meta.title, binned_at: meta.binned_at });
            setSidebarView("bin");
          } else {
            fetchMessagesForConversation(convId);
            // Backend api handles latest run trace, but we must pass conversationId to not bleed
            fetchRunTrace("latest", convId);
          }
        })
        .catch(() => {
          fetchMessagesForConversation(convId);
          fetchRunTrace("latest", convId);
        });
    } else {
      fetchRunTrace("latest", null);
    }

    const stored = localStorage.getItem("ai_ceo_sidebar_collapsed");
    if (stored) setSidebarCollapsed(stored === "true");
  }, []);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;
    if (activeRunId) {
      const checkStatus = () => fetchRunTrace(activeRunId);
      const status = runTraceData?.run?.status;
      const reviewerStatus = runTraceData?.run?.reviewer_status;
      const terminalStates = ["COMPLETED", "PARTIAL", "FAILED", "CANCELLED", "BLOCKED", "WAITING_OWNER", "WAITING_REVIEW", "DIRECT_READ"];

      const isTerminal = status && terminalStates.includes(status) && reviewerStatus !== "PENDING_REVIEW";

      if (!isTerminal) {
         setIsLoading(true);
         intervalId = setInterval(checkStatus, 2000);
      } else {
         setIsLoading(false);
         if (conversationId) {
           fetchMessagesForConversation(conversationId);
         }
      }
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [activeRunId, runTraceData?.run?.status, conversationId]);

  useEffect(() => {
    if (messages.length === 0) return;

    let frame = 0;
    // Conversation changed / history click / URL restore: once messages have
    // hydrated, jump the message container (only) to the latest message.
    if (conversationId !== prevConversationIdRef.current) {
      prevConversationIdRef.current = conversationId;
      frame = requestAnimationFrame(() => scrollChatToBottom("instant"));
    }
    // Same conversation: follow new content only if the Owner is already near the
    // bottom. A background poll that re-sets identical messages (same length,
    // not loading) never moves the viewport, and an Owner who scrolled up stays put.
    else if (messages.length > prevMessagesLengthRef.current || isLoading) {
      if (isNearBottomRef.current) {
        frame = requestAnimationFrame(() => scrollChatToBottom("instant"));
      }
    }

    prevMessagesLengthRef.current = messages.length;
    return () => cancelAnimationFrame(frame);
  }, [messages, isLoading, conversationId]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading || binnedInfo || notFoundId) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setActiveRightDrawer(null);
    setActiveRunId(null);
    setRunTraceData(null);
    isNearBottomRef.current = true; // force scroll to bottom on new user message

    try {
      let currentConvId = conversationId;
      if (!currentConvId) {
        currentConvId = crypto.randomUUID();
        setConversationId(currentConvId);
        window.history.pushState({}, "", `/ai-ceo?conversation=${currentConvId}`);
      }

      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          conversationId: currentConvId
        }),
      });

      const data = await response.json();
      if (data.response) {
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: data.response }]);
      }
      fetchRecentConversations();
      fetchMessagesForConversation(currentConvId);

      fetchBudgetAndWorkforce();
      if (data.runId) {
        fetchRunTrace(data.runId);
      } else if (data.status) {
        setRunTraceData({
          run: {
            status: "DIRECT_READ",
            reviewer_status: "N/A",
            current_step: "Direct database read completed",
            estimated_cost: 0
          }
        });
      }
    } catch (err: any) {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: `Error: ${err.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const toggleSidebar = () => {
    const val = !sidebarCollapsed;
    setSidebarCollapsed(val);
    localStorage.setItem("ai_ceo_sidebar_collapsed", String(val));
  };

  const p = budgetData?.period;
  const runStatus = runTraceData?.run?.status;
  const isRunActive = runStatus && !["COMPLETED", "PARTIAL", "FAILED", "CANCELLED", "BLOCKED", "WAITING_OWNER", "WAITING_REVIEW", "DIRECT_READ"].includes(runStatus) && runTraceData?.run?.reviewer_status !== "PENDING_REVIEW";

  const getStatusClass = (status?: string) => {
    switch (status) {
      case "HARD_STOP":
      case "OWNER_APPROVAL_REQUIRED": return "badge-hardstop";
      case "CRITICAL": return "badge-critical";
      case "HIGH": return "badge-high";
      case "WARNING": return "badge-warning";
      case "COMPLETED": return "badge-normal";
      case "FAILED": return "badge-hardstop";
      case "IN_PROGRESS":
      case "RUNNING": return "badge-running";
      default: return "badge-normal";
    }
  };

  const completedTasksCount = tasksData?.tasks?.filter((t:any) => t.status === "COMPLETED").length || 0;
  const totalTasksCount = tasksData?.tasks?.length || 0;

  return (
    <div className={`ai-workspace ${fullScreen ? 'full-screen' : ''}`}>
      {/* LEFT RAIL */}
      <div className={`ai-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-top-actions">
          <button className="sidebar-toggle-btn" onClick={toggleSidebar}>
            {sidebarCollapsed ? ">>" : "<<"}
          </button>
          <button className="new-chat-btn" onClick={() => {
            setSidebarView("recent");
            resetToNewChat();
          }}>
            <span className="icon">✨</span> {!sidebarCollapsed && "New Chat"}
          </button>
        </div>

        <div className="sidebar-nav-items">
          <button className="nav-item" onClick={() => setActiveRightDrawer("budget")}>
            <span className="icon">💰</span>
            {!sidebarCollapsed && (
              <div className="nav-info">
                <span className="nav-title">Budget</span>
                <span className="nav-sub">₹{(p?.available_amount ?? 15000).toFixed(2)} avail</span>
              </div>
            )}
          </button>

          <button className="nav-item" onClick={() => setActiveRightDrawer("workforce")}>
            <span className="icon">👥</span>
            {!sidebarCollapsed && (
              <div className="nav-info">
                <span className="nav-title">Workforce</span>
                <span className="nav-sub">{workforceData?.activeAgents || 0} active</span>
              </div>
            )}
          </button>

          <button className="nav-item" onClick={() => setActiveRightDrawer("knowledge")}>
            <span className="icon">🧠</span>
            {!sidebarCollapsed && (
              <div className="nav-info">
                <span className="nav-title">Knowledge</span>
                <span className="nav-sub">{memoryData?.count || 0} rules</span>
              </div>
            )}
          </button>

          <button className="nav-item" onClick={() => setActiveRightDrawer("capabilities")}>
            <span className="icon">🛡️</span>
            {!sidebarCollapsed && (
              <div className="nav-info">
                <span className="nav-title">Capabilities</span>
                <span className="nav-sub">{capabilityData?.count || 0} regs</span>
              </div>
            )}
          </button>

          <button className="nav-item" onClick={() => setActiveRightDrawer("datasources")}>
            <span className="icon">🔌</span>
            {!sidebarCollapsed && (
              <div className="nav-info">
                <span className="nav-title">Data Sources</span>
                <span className="nav-sub">{dataSourceData?.count || 0} conns</span>
              </div>
            )}
          </button>

          <button
            className={`nav-item ${sidebarView === "bin" ? "active" : ""}`}
            onClick={() => {
              setSidebarView(sidebarView === "bin" ? "recent" : "bin");
              fetchBinnedConversations();
            }}
            title="Bin"
          >
            <span className="icon">🗑️</span>
            {!sidebarCollapsed && (
              <div className="nav-info">
                <span className="nav-title">Bin ({binnedConversations.length})</span>
                <span className="nav-sub">restorable chats</span>
              </div>
            )}
          </button>
        </div>

        {!sidebarCollapsed && (
          <div className="ai-history">
            {sidebarView === "recent" ? (
              <>
                <h4>Recent Conversations</h4>
                {recentConversations.length > 0 && (
                  <button className="btn-outline-compact bulk-btn" disabled={binBusy} onClick={() => openBulkDialog("MOVE_ALL")}>
                    Move All to Bin
                  </button>
                )}
                {recentConversations.length === 0 ? (
                  <p className="empty-text">Owner communicates only with AI CEO.</p>
                ) : (
                  <div className="recent-conversations-list">
                    {recentConversations.map(c => (
                      <div key={c.id} className="conv-row">
                        <button
                          className={`nav-item ${c.id === conversationId ? 'active' : ''}`}
                          onClick={() => openActiveConversation(c.id)}
                          style={{ textAlign: 'left' }}
                        >
                          <span className="icon">💬</span>
                          <div className="nav-info">
                            <span className="nav-title" style={{textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', width: '100px'}}>{c.title}</span>
                            <span className="nav-sub">{new Date(c.updated_at).toLocaleTimeString()}</span>
                          </div>
                        </button>
                        <button
                          className="conv-menu-btn"
                          aria-label="Conversation options"
                          title="Options"
                          onClick={(e) => {
                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setConvMenu({ id: c.id, x: r.right, y: r.bottom });
                          }}
                        >
                          ⋯
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <h4>
                  Bin ({binnedConversations.length}){" "}
                  <button className="text-btn" onClick={() => setSidebarView("recent")}>← Recent</button>
                </h4>
                {binnedConversations.length > 0 && (
                  <div className="bulk-actions">
                    <button className="btn-outline-compact restore-btn" disabled={binBusy} onClick={() => openBulkDialog("RESTORE_ALL")}>
                      Restore All
                    </button>
                    <button className="btn-outline-compact danger" disabled={binBusy} onClick={() => openBulkDialog("DELETE_ALL")}>
                      Delete All Permanently
                    </button>
                  </div>
                )}
                {binnedConversations.length === 0 ? (
                  <p className="empty-text">Bin is empty.</p>
                ) : (
                  <div className="recent-conversations-list">
                    {binnedConversations.map(c => (
                      <div key={c.id} className="conv-row bin-row">
                        <button
                          className={`nav-item ${c.id === conversationId ? 'active' : ''}`}
                          onClick={() => openBinnedConversation(c)}
                          style={{ textAlign: 'left' }}
                        >
                          <span className="icon">🗑️</span>
                          <div className="nav-info">
                            <span className="nav-title" style={{textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', width: '100px'}}>{c.title}</span>
                            <span className="nav-sub">Binned {c.binned_at ? new Date(c.binned_at).toLocaleString() : ""}</span>
                          </div>
                        </button>
                        <div className="bin-actions">
                          <button className="btn-outline-compact restore-btn" disabled={binBusy} onClick={() => handleRestore(c.id)}>
                            Restore
                          </button>
                          <button className="btn-outline-compact danger" disabled={binBusy} onClick={() => openDeleteDialog(c)}>
                            Delete Permanently
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* CENTER CHAT WORKSPACE */}
      <div className="ai-chat-area">
        <div className="ai-header">
          <div className="header-titles">
            <h2>AI CEO</h2>
            <span className="header-subtitle">Executive AI Partner</span>
          </div>
          <div className="ai-status">
            {!fullScreen && (
              <button
                onClick={() => window.open("/ai-ceo", "_blank", "noopener,noreferrer")}
                className="btn-outline-compact"
              >
                Open AI CEO Full Screen ↗
              </button>
            )}
            <span className="governance-badge">ZOHO WRITE = 0</span>

            <button className="btn-outline-compact active-run-badge" onClick={() => setActiveRightDrawer("activity")}>
              ⚡ {isRunActive ? "RUNNING" : runStatus === "BLOCKED" ? "BLOCKED" : runStatus === "WAITING_OWNER" ? "OWNER ACTION REQUIRED" : runStatus === "WAITING_REVIEW" || runTraceData?.run?.reviewer_status === "PENDING_REVIEW" ? "WAITING REVIEW" : runStatus === "DIRECT_READ" ? "DIRECT READ" : runStatus ? "COMPLETED" : "Activity"}
            </button>
          </div>
        </div>

        {/* Compact Status Strip below header if we have a run trace */}
        {runStatus && (
          <div className={`compact-status-strip ${isRunActive ? 'active-strip' : 'completed-strip'}`}>
            <div className="strip-left">
              <span className="strip-icon">⚡</span>
              {isRunActive ? (
                <span>CEO is working: {runTraceData.run.current_step} ({completedTasksCount}/{totalTasksCount} tasks completed)</span>
              ) : (
                <span>Run {runStatus === "WAITING_OWNER" ? "OWNER ACTION REQUIRED" : runStatus === "DIRECT_READ" ? "DIRECT READ / COMPLETED" : runStatus} — Reviewer: {runTraceData.run.reviewer_status || "N/A"} — Estimated: ₹{runTraceData.run.estimated_cost?.toFixed(2) || "0.00"}</span>
              )}
            </div>
            <button className="text-btn" onClick={() => setActiveRightDrawer("activity")}>
              [View Activity]
            </button>
          </div>
        )}

        <div className="ai-messages" ref={messagesContainerRef} onScroll={handleScroll}>
          {notFoundId ? (
            <div className="ai-empty-state binned-notice">
              <h3>Conversation not found</h3>
              <p>This conversation does not exist. It may have been permanently deleted.</p>
              <button className="btn-outline-compact" onClick={() => resetToNewChat()}>Start New Chat</button>
            </div>
          ) : binnedInfo ? (
            <div className="ai-empty-state binned-notice">
              <h3>This conversation is in Bin</h3>
              <p>"{binnedInfo.title}"{binnedInfo.binned_at ? ` was moved to Bin on ${new Date(binnedInfo.binned_at).toLocaleString()}.` : " is in Bin."} Its messages are preserved. Restore it to continue.</p>
              <button className="btn-outline-compact success" disabled={binBusy} onClick={() => handleRestore(binnedInfo.id)}>
                Restore
              </button>
            </div>
          ) : messages.length === 0 ? (
            <div className="ai-empty-state">
              <h3>Welcome, Owner. What should the company accomplish?</h3>
              <div className="ai-suggestions">
                <button onClick={() => setInput("CEO, show me your current AI budget and explain how you would allocate resources if Accounts suddenly had a heavy workload.")}>
                  💰 Check AI Budget & Dynamic Allocation
                </button>
                <button onClick={() => setInput("Check P&L and compare with last month")}>
                  📊 Analyze Accounts & Performance
                </button>
                <button onClick={() => setInput("Check our sales for this month")}>
                  📈 Check Sales Operations
                </button>
                <button onClick={() => setInput("Check profitability of Project A.")}>
                  🏗️ Project Profitability
                </button>
              </div>
            </div>
          ) : (
            <div className="messages-container">
              {messages.map((msg) => (
                <div key={msg.id} className={`ai-message ${msg.role}`}>
                  <div className="message-content">
                    {msg.role === 'assistant' ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    ) : (
                      msg.content
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="ai-message assistant">
                  <div className="message-content typing-indicator">
                    <span>.</span><span>.</span><span>.</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="ai-input-area">
          <div className="composer-container">
            <form onSubmit={handleSubmit}>
              <textarea
                placeholder="Message your AI CEO... (Shift+Enter for newline)"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading || !!binnedInfo || !!notFoundId}
                rows={Math.min(5, input.split('\n').length || 1)}
              />
              <button type="submit" disabled={!input.trim() && !isLoading} className={isLoading ? "stop-btn" : ""}>
                {isLoading ? "Stop" : "Send"}
              </button>
            </form>
            <div className="ai-footer-info">
              AI Operating Budget: ₹15,000/mo. Real company financial authority is NOT granted. ZOHO WRITE = 0.
            </div>
          </div>
        </div>
      </div>

      {convMenu && (
        <>
          <div className="conv-menu-backdrop" onClick={() => setConvMenu(null)} />
          <div className="conv-menu" style={{ left: Math.max(8, convMenu.x - 150), top: convMenu.y + 4 }} role="menu">
            <button
              role="menuitem"
              onClick={() => {
                const c = recentConversations.find(x => x.id === convMenu.id);
                setConfirmBin({ id: convMenu.id, title: c?.title || "Untitled" });
                setConvMenu(null);
              }}
            >
              🗑️ Move to Bin
            </button>
          </div>
        </>
      )}

      {confirmBin && (
        <div className="bin-confirm-backdrop" onClick={() => !binBusy && setConfirmBin(null)}>
          <div className="bin-confirm" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Move this conversation to Bin?</h3>
            <p className="bin-confirm-title">"{confirmBin.title}"</p>
            <ul>
              <li>It will disappear from Recent Conversations.</li>
              <li>All messages are preserved.</li>
              <li>You can restore it later from Bin.</li>
            </ul>
            <div className="bin-confirm-actions">
              <button className="btn-outline-compact" disabled={binBusy} onClick={() => setConfirmBin(null)}>Cancel</button>
              <button className="btn-outline-compact danger" disabled={binBusy} onClick={() => handleMoveToBin(confirmBin.id)}>Move to Bin</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="bin-confirm-backdrop" onClick={() => !binBusy && setConfirmDelete(null)}>
          <div className="bin-confirm bin-delete-confirm" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Delete this conversation permanently?</h3>
            <p className="bin-confirm-title">"{confirmDelete.title}"</p>
            <p className="bin-confirm-id">ID: {confirmDelete.id}</p>
            {confirmDelete.impact ? (
              <ul>
                <li>{confirmDelete.impact.messageCount} message(s)</li>
                <li>{confirmDelete.impact.runCount} linked run(s)</li>
                <li>{confirmDelete.impact.taskCount} linked task(s)</li>
                <li>{confirmDelete.impact.otherLinkedRecordCount} other linked run record(s) (tool calls, approvals, audit events)</li>
              </ul>
            ) : (
              <p className="empty-text">{confirmDelete.error || "Loading impact…"}</p>
            )}
            <p className="bin-delete-warning">This action permanently deletes this conversation and cannot be undone.</p>
            <label className="bin-delete-ack">
              <input type="checkbox" checked={deleteAck} onChange={(e) => setDeleteAck(e.target.checked)} disabled={binBusy} />
              I understand this cannot be undone
            </label>
            {confirmDelete.impact && confirmDelete.error && <p className="bin-delete-warning">{confirmDelete.error}</p>}
            <div className="bin-confirm-actions">
              <button className="btn-outline-compact" disabled={binBusy} onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button
                className="btn-outline-compact danger"
                disabled={binBusy || !deleteAck || !confirmDelete.impact}
                onClick={() => handleDeletePermanently(confirmDelete.id)}
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkDlg && (
        <div className="bin-confirm-backdrop" onClick={closeBulkDialog}>
          <div
            className={`bin-confirm ${bulkDlg.kind === "DELETE_ALL" ? "bin-delete-confirm" : ""}`}
            role={bulkDlg.kind === "DELETE_ALL" ? "alertdialog" : "dialog"}
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>
              {bulkDlg.kind === "MOVE_ALL" && "Move all conversations to Bin?"}
              {bulkDlg.kind === "RESTORE_ALL" && "Restore all conversations from Bin?"}
              {bulkDlg.kind === "DELETE_ALL" && "Permanently delete ALL conversations in Bin?"}
            </h3>
            {bulkDlg.impact ? (
              bulkDlg.impact.counts.conversations === 0 ? (
                <p className="empty-text">
                  {bulkDlg.kind === "MOVE_ALL" ? "There are no active conversations." : "Bin is empty. Nothing to do."}
                </p>
              ) : (
                <ul>
                  <li>{bulkDlg.impact.counts.conversations} conversation(s)</li>
                  <li>{bulkDlg.impact.counts.messages} message(s)</li>
                  <li>{bulkDlg.impact.counts.runs} linked run(s)</li>
                  <li>{bulkDlg.impact.counts.tasks} linked task(s)</li>
                  {bulkDlg.kind === "DELETE_ALL" && (
                    <li>{bulkDlg.impact.otherScopedRows} other linked run record(s) (tool calls, approvals, audit events)</li>
                  )}
                </ul>
              )
            ) : (
              <p className="empty-text">{bulkDlg.error || "Loading impact…"}</p>
            )}
            {bulkDlg.kind === "MOVE_ALL" && <p>Messages are preserved. You can restore them from Bin.</p>}
            {bulkDlg.kind === "RESTORE_ALL" && <p>They will return to Recent Conversations.</p>}
            {bulkDlg.kind === "DELETE_ALL" && (
              <>
                <p className="bin-delete-warning">
                  This permanently deletes every conversation currently in Bin and cannot be undone. Active conversations are not affected.
                  A verified backup is created automatically before anything is deleted; if the backup fails, nothing is deleted.
                </p>
                <label className="bin-delete-ack">
                  <input type="checkbox" checked={bulkAck} onChange={(e) => setBulkAck(e.target.checked)} disabled={binBusy} />
                  I understand this cannot be undone
                </label>
                <label className="bin-delete-ack">
                  Type <b>DELETE ALL</b> to confirm
                  <input
                    type="text"
                    className="bulk-phrase-input"
                    value={bulkPhrase}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setBulkPhrase(e.target.value)}
                    disabled={binBusy}
                  />
                </label>
              </>
            )}
            {bulkDlg.impact && bulkDlg.error && <p className="bin-delete-warning">{bulkDlg.error}</p>}
            <div className="bin-confirm-actions">
              <button className="btn-outline-compact" disabled={binBusy} onClick={closeBulkDialog}>Cancel</button>
              <button
                className={`btn-outline-compact ${bulkDlg.kind === "RESTORE_ALL" ? "restore-btn" : "danger"}`}
                disabled={
                  binBusy ||
                  !bulkDlg.impact ||
                  bulkDlg.impact.counts.conversations === 0 ||
                  (bulkDlg.kind === "DELETE_ALL" && (!bulkAck || bulkPhrase !== "DELETE ALL"))
                }
                onClick={handleBulkConfirm}
              >
                {bulkDlg.kind === "MOVE_ALL" && "Move All to Bin"}
                {bulkDlg.kind === "RESTORE_ALL" && "Restore All"}
                {bulkDlg.kind === "DELETE_ALL" && "Delete All Permanently"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RIGHT ACTIVITY DRAWER */}
      {activeRightDrawer && (
        <div className="right-drawer">
          <div className="right-drawer-header">
            <h3>
              {activeRightDrawer === "activity" && "CEO Work Activity"}
              {activeRightDrawer === "budget" && "Budget Overview"}
              {activeRightDrawer === "workforce" && "Workforce Registry"}
              {activeRightDrawer === "knowledge" && "Governed Knowledge"}
              {activeRightDrawer === "capabilities" && "Capabilities & Tools"}
              {activeRightDrawer === "datasources" && "Data Sources"}
            </h3>
            <button className="close-btn" onClick={() => setActiveRightDrawer(null)}>✕</button>
          </div>

          <div className="right-drawer-content">
            {activeRightDrawer === "activity" && (
              <>
                <div className="trace-summary-grid">
                  <div className="trace-summary-item">
                    <span className="stat-label">Run Status</span>
                    <span className={`status-pill status-${(runTraceData?.run?.status || "IDLE").toLowerCase()}`}>{runTraceData?.run?.status || "IDLE"}</span>
                  </div>
                  <div className="trace-summary-item">
                    <span className="stat-label">Reviewer Status</span>
                    <span>{runTraceData?.run?.reviewer_required ? (runTraceData?.run?.reviewer_status || "WAITING") : "Standard"}</span>
                  </div>
                  <div className="trace-summary-item">
                    <span className="stat-label">Cost</span>
                    <span>₹{runTraceData?.run?.estimated_cost?.toFixed(2) || "0.00"}</span>
                  </div>
                  <div className="trace-summary-item">
                    <span className="stat-label">Actions</span>
                    {isRunActive ? (
                       <button onClick={() => fetch(`/api/ai/runs/${activeRunId}/cancel`, {method: "POST"}).then(() => fetchRunTrace(activeRunId!))} className="btn-outline-compact danger">Cancel</button>
                    ) : (runTraceData?.run?.status === "WAITING_OWNER" ? (
                       <button onClick={() => fetch(`/api/ai/runs/${activeRunId}/resume`, {method: "POST"}).then(() => fetchRunTrace(activeRunId!))} className="btn-outline-compact success">Resume</button>
                    ) : <span>-</span>)}
                  </div>
                </div>

                <h4 style={{marginTop: 16, marginBottom: 8, fontSize: 14}}>Task Graph</h4>
                {tasksData?.tasks?.map((t: any) => (
                  <div className="task-card" key={t.id} onClick={() => setExpandedTasks(prev => ({...prev, [t.id]: !prev[t.id]}))}>
                    <div className="task-card-header">
                      <span className="task-status-icon">
                        {t.status === "COMPLETED" ? "✓" : t.status === "FAILED" ? "✕" : "●"}
                      </span>
                      <strong>{t.objective}</strong>
                    </div>
                    <div className="task-card-meta">
                      <span className="agent-name">{t.assigned_agent_id}</span>
                      {runTraceData?.auditEvents?.some((e:any) => e.event_type === "AGENT_REUSED" && e.details.includes(t.assigned_agent_id)) && (
                        <span className="reused-badge">REUSED</span>
                      )}
                    </div>
                    {expandedTasks[t.id] && (
                      <div className="task-card-details">
                        <div><strong>Department:</strong> {t.department || "EXECUTIVE"}</div>
                        <div><strong>Cost:</strong> ₹{(t.actual_cost || t.estimated_cost || 0).toFixed(2)}</div>
                        <div><strong>Dependencies:</strong> {t.dependencies?.length || 0}</div>
                        <div><strong>Status:</strong> {t.status}</div>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {activeRightDrawer === "budget" && (
              <div className="drawer-panel-content">
                <div className="trace-summary-grid">
                  <div className="trace-summary-item">
                    <span className="stat-label">Monthly Limit</span>
                    <span className="stat-val">₹{(p?.monthly_limit ?? 15000).toLocaleString("en-IN")}</span>
                  </div>
                  <div className="trace-summary-item">
                    <span className="stat-label">Available</span>
                    <span className="stat-val highlight-green">₹{(p?.available_amount ?? 15000).toFixed(2)}</span>
                  </div>
                  <div className="trace-summary-item">
                    <span className="stat-label">Month-to-Date Estimated</span>
                    <span className="stat-val">₹{(p?.consumed_amount ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="trace-summary-item">
                    <span className="stat-label">Committed</span>
                    <span className="stat-val">₹{(p?.committed_amount ?? 0).toFixed(2)}</span>
                  </div>
                </div>

                <h4 style={{marginTop: 16, marginBottom: 8, fontSize: 14}}>Department Allocations</h4>
                {budgetData?.departmentBudgets?.map(b => (
                   <div className="task-card" key={b.department_id}>
                     <strong>{b.department_id}</strong>
                     <div style={{fontSize: 12, color: "#64748b", marginTop: 4}}>Allocated: ₹{b.allocated_amount} | Consumed: ₹{b.consumed_amount}</div>
                   </div>
                ))}
              </div>
            )}

            {activeRightDrawer === "workforce" && (
              <div className="drawer-panel-content">
                {workforceData?.agents?.map(a => (
                   <div className="task-card" key={a.id}>
                     <strong>{a.name}</strong> <span className={`status-pill status-${a.status.toLowerCase()}`}>{a.status}</span>
                     <div style={{fontSize: 12, color: "#64748b", marginTop: 4}}>
                       {a.role} • {a.department} <br/>
                       Tasks: {a.tasks_completed || 0} • Last Used: {a.last_used_at ? new Date(a.last_used_at).toLocaleTimeString() : "Never"}
                     </div>
                   </div>
                ))}
              </div>
            )}

            {activeRightDrawer === "knowledge" && (
              <div className="drawer-panel-content">
                {memoryData?.memories?.map(m => (
                   <div className="task-card" key={m.id}>
                     <strong>{m.title}</strong> <span className={`authority-pill auth-${m.authority_level.toLowerCase()}`}>{m.authority_level}</span>
                     <div style={{fontSize: 12, color: "#64748b", marginTop: 4}}>
                       Scope: {m.scope_type} • Type: {m.memory_type} <br/>
                       {m.content}
                     </div>
                   </div>
                ))}
              </div>
            )}

            {activeRightDrawer === "capabilities" && (
              <div className="drawer-panel-content">
                {capabilityData?.capabilities?.map(c => (
                   <div className="task-card" key={c.id}>
                     <strong>{c.name}</strong> <code>{c.code}</code>
                     <div style={{fontSize: 12, color: "#64748b", marginTop: 4}}>
                       Risk: {c.riskClass} • Default Tool: {c.defaultToolClass}
                     </div>
                   </div>
                ))}

                <h4 style={{marginTop: 16, marginBottom: 8, fontSize: 14}}>Tools</h4>
                {toolData?.tools?.map(t => (
                   <div className="task-card" key={t.id}>
                     <strong>{t.name}</strong> <code>{t.code}</code>
                     <div style={{fontSize: 12, color: "#64748b", marginTop: 4}}>
                       Class: {t.toolClass} • Approval: {t.requiresApproval ? "Yes" : "No"}
                     </div>
                   </div>
                ))}
              </div>
            )}

            {activeRightDrawer === "datasources" && (
              <div className="drawer-panel-content">
                {dataSourceData?.dataSources?.map(ds => (
                   <div className="task-card" key={ds.id}>
                     <strong>{ds.name}</strong> <code>{ds.code}</code>
                     <div style={{fontSize: 12, color: "#64748b", marginTop: 4}}>
                       Mode: {ds.accessMode} • Sync: {ds.freshnessStrategy} <br/>
                       Status: {ds.currentStatus || "UNKNOWN"}
                     </div>
                   </div>
                ))}
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}

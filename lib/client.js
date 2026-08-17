// dsh-deepseek-quota — browser half.
//
// v0.4.1: the card is now draggable (position persisted in localStorage).
// A floating card in the dsh web GUI (registered into the frame-wide
// `shell.overlay` slot — additive, above every column, click-through until
// the card opts back into pointer events). Defaults to the bottom-right
// corner; drag anywhere on the card to move it (position persisted in
// localStorage, double-click resets to the default corner).
// It polls the host route `/api/deepseek-balance` (see lib/index.js) every
// minute and shows the remaining DeepSeek API balance plus today's
// consumption, with a manual refresh button and explicit error states.
// Styling uses only `--dsw-*` theme tokens that exist in the shipped theme
// build, so it follows light/dark mode.
window.__ModuleLoader__.load({
	id: "dsh-deepseek-quota",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let jsxRuntime = require("react/jsx-runtime");
		const { useState, useEffect, useCallback, useRef } = react;
		const { jsx, jsxs, Fragment } = jsxRuntime;

		// ---- constants -------------------------------------------------
		const POLL_MS = 60 * 1000;
		const BALANCE_PATH = "/api/deepseek-balance";
		// 拖拽位置持久化（localStorage；null = 默认右下角锚点）。
		const POS_STORAGE_KEY = "dsh-deepseek-quota-pos";
		// 卡片与视口/侧边栏面板之间的留白。
		const CARD_MARGIN = 16;

		function clamp(value, min, max) {
			return Math.min(max, Math.max(min, value));
		}

		function loadStoredPos() {
			try {
				const raw = localStorage.getItem(POS_STORAGE_KEY);
				if (!raw) return null;
				const parsed = JSON.parse(raw);
				if (!parsed || typeof parsed !== "object") return null;
				const x = Number(parsed.x);
				const y = Number(parsed.y);
				if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
				return { x, y };
			} catch {
				return null;
			}
		}

		// ---- small helpers ---------------------------------------------
		function currencySymbol(code) {
			switch (code) {
				case "CNY": return "¥";
				case "USD": return "$";
				case "EUR": return "€";
				case "JPY": return "¥";
				case "HKD": return "HK$";
				default: return code ? `${code} ` : "";
			}
		}

		function formatBalance(value, currency) {
			const symbol = currencySymbol(currency);
			return `${symbol}${String(value)}`;
		}

		// 费用展示：按量级选择小数位，避免 ¥0.000000… 长尾（参考 dsh-web-billing）。
		function formatCost(value, currency) {
			const symbol = currencySymbol(currency);
			if (!Number.isFinite(value) || value <= 0) return `${symbol}0`;
			if (value >= 100) return `${symbol}${value.toFixed(0)}`;
			if (value >= 1) return `${symbol}${value.toFixed(2)}`;
			if (value >= 0.01) return `${symbol}${value.toFixed(3)}`;
			return `${symbol}${value.toPrecision(2)}`;
		}

		// 千分位格式化 token 数。
		function formatTokens(value) {
			return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		}

		// 单价展示（¥/M，CNY 计价）。
		function formatRate(rate) {
			const n = rate >= 1 ? rate.toFixed(2) : rate.toFixed(3);
			return `¥${n}/M`;
		}

		function formatTime(date) {
			const hh = String(date.getHours()).padStart(2, "0");
			const mm = String(date.getMinutes()).padStart(2, "0");
			const ss = String(date.getSeconds()).padStart(2, "0");
			return `${hh}:${mm}:${ss}`;
		}

		async function fetchBalance() {
			const res = await fetch(BALANCE_PATH, { cache: "no-store" });
			let body = null;
			try {
				body = await res.json();
			} catch {}
			if (!res.ok) {
				const message =
					body && typeof body.message === "string"
						? body.message
						: `请求失败（HTTP ${res.status}）`;
				const error = new Error(message);
				error.code = body && typeof body.error === "string" ? body.error : `http-${res.status}`;
				throw error;
			}
			// New host shape: { ok, balance, todayConsumed }. Older host:
			// the raw provider payload verbatim. Accept both.
			const payload = body && typeof body === "object" && body.balance ? body.balance : body;
			const todayConsumed =
				body && typeof body === "object" && typeof body.todayConsumed === "number"
					? body.todayConsumed
					: null;
			return { payload, todayConsumed };
		}

		// ---- inline styles ---------------------------------------------
		const card = {
			position: "absolute",
			right: 16,
			bottom: 16,
			zIndex: 30,
			pointerEvents: "auto",
			boxSizing: "border-box",
			width: 240,
			borderRadius: 12,
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "var(--dsw-alias-bg-overlay)",
			boxShadow: "0 4px 16px rgba(0, 0, 0, 0.16)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 12,
			lineHeight: "18px",
			padding: "8px 10px",
			display: "flex",
			flexDirection: "column",
			gap: 2
		};

		const headerRow = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			height: 20
		};

		const title = {
			flex: 1,
			minWidth: 0,
			display: "flex",
			alignItems: "center",
			gap: 6,
			fontWeight: 600,
			whiteSpace: "nowrap",
			overflow: "hidden",
			textOverflow: "ellipsis"
		};

		const refreshButton = {
			flex: "none",
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: 20,
			height: 20,
			border: 0,
			borderRadius: 6,
			padding: 0,
			background: "transparent",
			color: "var(--dsw-alias-label-secondary)",
			cursor: "pointer"
		};

		const balanceRow = {
			display: "flex",
			alignItems: "baseline",
			gap: 6
		};

		const balanceValue = {
			fontSize: 20,
			lineHeight: "26px",
			fontWeight: 700,
			fontVariantNumeric: "tabular-nums",
			whiteSpace: "nowrap"
		};

		const statusChip = {
			flex: "none",
			borderRadius: 999,
			padding: "0 6px",
			fontSize: 10,
			lineHeight: "16px"
		};

		// 双列统计格：今日消费 | 当前对话费用（label 上、值下，省高度）。
		const statGrid = {
			display: "grid",
			gridTemplateColumns: "1fr 1fr",
			gap: 8,
			marginTop: 2
		};

		const statCell = {
			display: "flex",
			flexDirection: "column",
			gap: 0,
			minWidth: 0
		};

		const statLabel = {
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 10,
			lineHeight: "14px",
			whiteSpace: "nowrap"
		};

		const statValue = {
			display: "inline-flex",
			alignItems: "center",
			gap: 3,
			fontSize: 14,
			lineHeight: "20px",
			fontWeight: 600,
			fontVariantNumeric: "tabular-nums",
			whiteSpace: "nowrap",
			overflow: "hidden",
			textOverflow: "ellipsis"
		};

		const infoIcon = {
			flex: "none",
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			width: 14,
			height: 14,
			borderRadius: "50%",
			color: "var(--dsw-alias-label-secondary)",
			cursor: "help",
			verticalAlign: "middle"
		};

		const tipBox = {
			position: "absolute",
			bottom: "calc(100% + 8px)",
			right: 0,
			zIndex: 40,
			boxSizing: "border-box",
			width: 310,
			borderRadius: 10,
			border: "1px solid var(--dsw-alias-border-l2)",
			background: "var(--dsw-alias-bg-overlay)",
			boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
			padding: "8px 10px",
			fontSize: 11,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-primary)",
			display: "flex",
			flexDirection: "column",
			gap: 2
		};

		const tipTitle = {
			fontWeight: 600,
			fontSize: 12,
			lineHeight: "18px",
			marginBottom: 2,
			fontVariantNumeric: "tabular-nums"
		};

		const tipRow = {
			display: "flex",
			alignItems: "baseline",
			justifyContent: "space-between",
			gap: 8,
			fontVariantNumeric: "tabular-nums"
		};

		const tipLabel = {
			color: "var(--dsw-alias-label-secondary)",
			flex: "none",
			whiteSpace: "nowrap"
		};

		const tipFormula = {
			color: "var(--dsw-alias-label-primary)",
			textAlign: "right",
			whiteSpace: "nowrap",
			overflow: "hidden",
			textOverflow: "ellipsis"
		};

		const tipFooter = {
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 10,
			lineHeight: "16px",
			marginTop: 2,
			borderTop: "1px solid var(--dsw-alias-border-l1)",
			paddingTop: 4,
			fontVariantNumeric: "tabular-nums"
		};

		const metaRow = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 11,
			lineHeight: "16px",
			whiteSpace: "nowrap",
			overflow: "hidden"
		};

		const metaItem = {
			display: "flex",
			alignItems: "center",
			gap: 4,
			fontVariantNumeric: "tabular-nums",
			minWidth: 0,
			overflow: "hidden",
			textOverflow: "ellipsis"
		};

		// 标题行内嵌的更新时间（小字，省一行）。
		const headerTime = {
			flex: "none",
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 10,
			lineHeight: "14px",
			fontVariantNumeric: "tabular-nums",
			whiteSpace: "nowrap"
		};

		const errorText = {
			color: "var(--dsw-alias-state-error-primary)",
			fontSize: 11,
			lineHeight: "16px",
			wordBreak: "break-all"
		};

		const loadingText = {
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 12,
			lineHeight: "18px"
		};

		// ---- the widget -------------------------------------------------
		function DeepSeekQuotaBadge(props) {
			const useSessions = props.useSessions;
			const [data, setData] = useState(null);
			const [phase, setPhase] = useState("loading"); // loading | ready | error
			const [message, setMessage] = useState("");
			const [updatedAt, setUpdatedAt] = useState(null);
			const [spinning, setSpinning] = useState(false);
			const [conversation, setConversation] = useState(null); // 会话费用接口的完整返回（含 breakdown）
			const [tipOpen, setTipOpen] = useState(false);
			const mounted = useRef(true);

			// 拖拽位置：userPos = 用户保存的位置（持久化；null = 默认右下角锚点）；
			// renderPos = 实际渲染位置（userPos 经 better-sidebar 面板让位约束后的
			// 值，侧边栏折叠、约束放松时自动回到 userPos，实现"归位"）。
			const cardRef = useRef(null);
			const [userPos, setUserPos] = useState(loadStoredPos);
			const [renderPos, setRenderPos] = useState(null);
			const [dragging, setDragging] = useState(false);
			const dragRef = useRef(null);
			const userPosRef = useRef(userPos);
			userPosRef.current = userPos;

			// better-sidebar 布局让位：insets = 右侧面板/底部面板在视口中占用的
			// 宽/高（无该插件时为 0）；adjInsets = 换算成相对卡片所在容器（overlay
			// 层）的让位量——overlay 层会随 #root 的 margin 收缩，收缩掉的部分
			// 无需再让，避免重复偏移。
			const insetsRef = useRef({ right: 0, bottom: 0 });
			const adjInsetsRef = useRef({ right: 0, bottom: 0 });
			const [adjInsets, setAdjInsets] = useState({ right: 0, bottom: 0 });

			// 监听 better-sidebar 的布局变量（写在 <html> 内联样式上）。用
			// MutationObserver 观察 style 属性变化（零采样延迟），rAF 节流到每帧
			// 一次，1s 兜底轮询防漏。变量变化时重算让位与渲染位置。
			useEffect(() => {
				const readShell = () => {
					const cs = getComputedStyle(document.documentElement);
					const parse = (raw) => {
						const n = parseFloat(raw);
						return Number.isFinite(n) && n > 0 ? n : 0;
					};
					return {
						right: parse(cs.getPropertyValue("--dsh-sidebar-width")),
						bottom: parse(cs.getPropertyValue("--dsh-sidebar-height"))
					};
				};
				const apply = () => {
					const el = cardRef.current;
					const insets = readShell();
					let adjusted = { right: insets.right, bottom: insets.bottom };
					if (el) {
						const parent = el.offsetParent || el.parentElement;
						if (parent) {
							const pr = parent.getBoundingClientRect();
							// 容器右/下边界已随布局收缩的量（收缩部分无需再让位）。
							adjusted = {
								right: Math.max(0, insets.right - Math.max(0, window.innerWidth - pr.right)),
								bottom: Math.max(0, insets.bottom - Math.max(0, window.innerHeight - pr.bottom))
							};
						}
					}
					insetsRef.current = insets;
					adjInsetsRef.current = adjusted;
					setAdjInsets((prev) => (prev.right === adjusted.right && prev.bottom === adjusted.bottom ? prev : adjusted));
					applyInsetsRef.current();
				};
				let rafId = 0;
				const schedule = () => {
					if (rafId) return;
					rafId = requestAnimationFrame(() => {
						rafId = 0;
						apply();
					});
				};
				apply();
				const observer = new MutationObserver(schedule);
				observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
				const timer = setInterval(apply, 1000);
				return () => {
					clearInterval(timer);
					observer.disconnect();
					if (rafId) cancelAnimationFrame(rafId);
				};
			}, []);

			// 当前会话 id（SessionListState.current，由框架标准属性注入）。
			const currentSessionId = typeof useSessions === "function" ? useSessions((s) => s.current) : void 0;

			// 轮询当前对话费用（宿主按会话日志回放计价，5s 一次，本地路由开销可忽略）。
			useEffect(() => {
				if (currentSessionId === void 0) {
					setConversation(null);
					return;
				}
				let cancelled = false;
				const loadCost = async () => {
					try {
						const res = await fetch(`/api/deepseek-session-cost?sessionId=${encodeURIComponent(currentSessionId)}`, { cache: "no-store" });
						const body = await res.json();
						if (cancelled || body === null || typeof body !== "object" || body.ok !== true) return;
						setConversation(body);
					} catch {}
				};
				loadCost();
				const timer = setInterval(loadCost, 5000);
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, [currentSessionId]);

			const load = useCallback(async () => {
				setSpinning(true);
				try {
					const result = await fetchBalance();
					if (!mounted.current) return;
					setData(result);
					setPhase("ready");
					setMessage("");
					setUpdatedAt(new Date());
				} catch (error) {
					if (!mounted.current) return;
					setPhase("error");
					setMessage(error instanceof Error ? error.message : String(error));
				} finally {
					if (mounted.current) setSpinning(false);
				}
			}, []);

			useEffect(() => {
				mounted.current = true;
				load();
				const timer = setInterval(load, POLL_MS);
				return () => {
					mounted.current = false;
					clearInterval(timer);
				};
			}, [load]);

			// ---- 拖拽移动（按住卡片拖动，松手持久化到 localStorage） ----
			// 把 userPos 经 better-sidebar 面板让位约束换算成 renderPos。约束只
			// 收不扩：面板展开时位置被推开，折叠后自动回到 userPos（归位）。
			const applyInsets = useCallback(() => {
				// 拖拽中位置由 pointer 事件驱动：外部重算（面板变量轮询/observer、
				// resize）会基于拖拽前的 userPos 把卡片闪回原位置，这里直接跳过。
				if (dragRef.current) return;
				const el = cardRef.current;
				const user = userPosRef.current;
				if (!user) {
					// 默认锚点（右下角 + 让位）由样式里的 adjInsets 处理。
					setRenderPos(null);
					return;
				}
				if (!el) return;
				const parent = el.offsetParent || el.parentElement;
				if (!parent) return;
				const rect = el.getBoundingClientRect();
				const parentRect = parent.getBoundingClientRect();
				const insets = insetsRef.current;
				// 视口坐标约束：卡片不得进入 better-sidebar 面板区域（右侧面板
				// / 底部面板，fixed z-index 50）。parentRect 偏移用于换算成相对
				// 容器的坐标。
				const maxX = Math.max(0, window.innerWidth - insets.right - CARD_MARGIN - rect.width - parentRect.left);
				const maxY = Math.max(0, window.innerHeight - insets.bottom - CARD_MARGIN - rect.height - parentRect.top);
				setRenderPos({
					x: clamp(user.x, 0, maxX),
					y: clamp(user.y, 0, maxY)
				});
			}, []);

			const applyInsetsRef = useRef(applyInsets);
			applyInsetsRef.current = applyInsets;

			// 用户位置变化（拖拽结束/复位）时重算渲染位置。
			useEffect(() => {
				applyInsets();
			}, [userPos, applyInsets]);

			// 挂载时与窗口尺寸变化时重算（视口/容器尺寸影响夹取边界）。
			useEffect(() => {
				applyInsets();
				window.addEventListener("resize", applyInsets);
				return () => window.removeEventListener("resize", applyInsets);
			}, [applyInsets]);

			const onPointerDown = (e) => {
				if (e.button !== 0) return;
				// 交互元素（刷新按钮、ⓘ）不触发拖拽。
				if (e.target.closest("button") || e.target.closest('[role="button"]')) return;
				const el = cardRef.current;
				if (!el) return;
				const parent = el.offsetParent || el.parentElement;
				if (!parent) return;
				const rect = el.getBoundingClientRect();
				const parentRect = parent.getBoundingClientRect();
				const insets = insetsRef.current;
				dragRef.current = {
					pointerId: e.pointerId,
					startX: e.clientX,
					startY: e.clientY,
					startLeft: rect.left - parentRect.left,
					startTop: rect.top - parentRect.top,
					maxX: Math.max(0, window.innerWidth - insets.right - CARD_MARGIN - rect.width - parentRect.left),
					maxY: Math.max(0, window.innerHeight - insets.bottom - CARD_MARGIN - rect.height - parentRect.top)
				};
				setDragging(true);
				try {
					el.setPointerCapture(e.pointerId);
				} catch {}
				e.preventDefault();
			};

			const onPointerMove = (e) => {
				const d = dragRef.current;
				if (!d || e.pointerId !== d.pointerId) return;
				setRenderPos({
					x: clamp(d.startLeft + e.clientX - d.startX, 0, d.maxX),
					y: clamp(d.startTop + e.clientY - d.startY, 0, d.maxY)
				});
			};

			const endDrag = (e) => {
				const d = dragRef.current;
				if (!d || e.pointerId !== d.pointerId) return;
				dragRef.current = null;
				setDragging(false);
				try {
					cardRef.current && cardRef.current.releasePointerCapture(e.pointerId);
				} catch {}
				const el = cardRef.current;
				if (!el) return;
				const parent = el.offsetParent || el.parentElement;
				if (!parent) return;
				// 以松手瞬间的实测尺寸重新夹取（卡片高度可能因刷新而变化）。
				const rect = el.getBoundingClientRect();
				const parentRect = parent.getBoundingClientRect();
				const insets = insetsRef.current;
				const next = {
					x: clamp(rect.left - parentRect.left, 0, Math.max(0, window.innerWidth - insets.right - CARD_MARGIN - rect.width - parentRect.left)),
					y: clamp(rect.top - parentRect.top, 0, Math.max(0, window.innerHeight - insets.bottom - CARD_MARGIN - rect.height - parentRect.top))
				};
				setRenderPos(next);
				// 拖拽终点即用户新位置：更新 userPos 并持久化。
				userPosRef.current = next;
				setUserPos(next);
				try {
					localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(next));
				} catch {}
			};

			// 双击卡片复位到默认右下角。
			const resetPos = (e) => {
				if (e.target.closest("button") || e.target.closest('[role="button"]')) return;
				dragRef.current = null;
				setDragging(false);
				userPosRef.current = null;
				setUserPos(null);
				setRenderPos(null);
				try {
					localStorage.removeItem(POS_STORAGE_KEY);
				} catch {}
			};

			const payload = data ? data.payload : null;
			const balance = payload && Array.isArray(payload.balance_infos) ? payload.balance_infos[0] : null;
			// 余额构成（DeepSeek /user/balance）：total = granted + topped_up，
			// 三者均为"当前剩余"。无赠送余额时 total === topped_up，明细行会与
			// 大数字重复——此时隐藏明细行，避免冗余。
			const granted = balance ? Number(balance.granted_balance) : 0;
			const toppedUp = balance ? Number(balance.topped_up_balance) : 0;
			const showGranted = granted > 0;
			const showToppedUp = toppedUp > 0;
			const showMeta = showGranted || showToppedUp;
			const available = payload ? payload.is_available !== false : null;
			const currency = balance ? balance.currency : "CNY";
			const todayConsumed = data ? data.todayConsumed : null;

			const conversationCost = conversation && typeof conversation.cost === "number" ? conversation.cost : null;
			const breakdown = conversation && Array.isArray(conversation.breakdown) ? conversation.breakdown : null;
			const formulaLines = breakdown ? breakdown.filter((b) => b !== null && typeof b === "object" && b.tokens > 0) : [];

			const stateColor =
				phase === "error"
					? "var(--dsw-alias-state-error-primary)"
					: available === false
						? "var(--dsw-alias-state-error-primary)"
						: "var(--dsw-alias-state-success-primary)";

			let chip = null;
			if (phase === "ready") {
				chip = jsx("span", {
					style: {
						...statusChip,
						color: stateColor,
						background: "var(--dsw-alias-interactive-bg-hover)"
					},
					children: available === false ? "不可用" : "可用"
				});
			} else if (phase === "error") {
				chip = jsx("span", {
					style: { ...statusChip, color: stateColor },
					children: "错误"
				});
			}

			const dot = jsx("span", {
				style: {
					flex: "none",
					width: 8,
					height: 8,
					borderRadius: "50%",
					background: phase === "loading" ? "var(--dsw-alias-label-secondary)" : stateColor
				},
				"aria-hidden": true
			});

			const refreshIcon = jsx("svg", {
				width: 13,
				height: 13,
				viewBox: "0 0 16 16",
				fill: "none",
				style: spinning ? { animation: "dsh-quota-spin 0.8s linear infinite" } : void 0,
				children: jsx("path", {
					d: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});

			return jsx("div", {
				ref: cardRef,
				role: "status",
				"aria-live": "polite",
				"data-plugin": "dsh-deepseek-quota",
				title: "DeepSeek API 额度（按住拖动可移动，双击复位）",
				style: {
					...card,
					cursor: dragging ? "grabbing" : "grab",
					touchAction: "none",
					...(dragging ? { userSelect: "none" } : {}),
					// 默认锚点：右下角 + better-sidebar 面板让位（overlay 层已随
					// #root margin 收缩的部分不再重复让位，见 adjInsets）。
					...(renderPos
						? { right: "auto", bottom: "auto", left: renderPos.x, top: renderPos.y }
						: { right: CARD_MARGIN + adjInsets.right, bottom: CARD_MARGIN + adjInsets.bottom }),
					// 非拖拽时让位/归位过渡与 better-sidebar 的展开动画同一时长
					// 同一缓动（主题变量），跟手拖动时不加过渡。
					...(dragging
						? {}
						: {
							transition: [
								"left var(--ds-transition-duration-slow, 0.25s) var(--ds-ease-in-out, ease)",
								"top var(--ds-transition-duration-slow, 0.25s) var(--ds-ease-in-out, ease)",
								"right var(--ds-transition-duration-slow, 0.25s) var(--ds-ease-in-out, ease)",
								"bottom var(--ds-transition-duration-slow, 0.25s) var(--ds-ease-in-out, ease)"
							].join(", ")
						})
				},
				onPointerDown: onPointerDown,
				onPointerMove: onPointerMove,
				onPointerUp: endDrag,
				onPointerCancel: endDrag,
				onDoubleClick: resetPos,
				children: jsxs(Fragment, {
					children: [
						jsxs("div", {
							style: headerRow,
							children: [
								dot,
								jsx("span", { style: title, children: "DeepSeek 额度" }),
								updatedAt ? jsx("span", { style: headerTime, children: formatTime(updatedAt) }) : null,
								jsx("button", {
									type: "button",
									style: refreshButton,
									"aria-label": "刷新额度",
									title: "刷新",
									disabled: spinning,
									onClick: () => { load(); },
									children: refreshIcon
								})
							]
						}),
						phase === "loading"
							? jsx("div", { style: loadingText, children: "加载中…" })
							: phase === "error"
								? jsx("div", {
									style: errorText,
									title: message,
									children: message
								})
								: jsxs(Fragment, {
									children: [
										jsxs("div", {
											style: balanceRow,
											children: [
												jsx("span", { style: balanceValue, children: balance ? formatBalance(balance.total_balance, currency) : "—" }),
												chip
											]
										}),
										jsx("div", {
											style: statGrid,
											children: [
												todayConsumed !== null
													? jsx("div", {
														style: statCell,
														children: [
															jsx("span", { style: statLabel, children: `今日${data.todayConsumedSource === "official" ? "已消费" : "约消费"}` }),
															jsx("span", { style: statValue, children: formatBalance(todayConsumed, currency) })
														]
													})
													: null,
												currentSessionId !== void 0 && conversationCost !== null
													? jsx("div", {
														style: statCell,
														children: [
															jsx("span", { style: statLabel, children: "当前对话费用" }),
															jsxs("span", {
																style: statValue,
																children: [
																	formatCost(conversationCost, currency),
																	jsx("span", {
																		role: "button",
																		tabIndex: 0,
																		"aria-label": "查看当前对话费用计算公式",
																		title: "查看计算公式",
																		style: infoIcon,
																		onMouseEnter: () => { setTipOpen(true); },
																		onMouseLeave: () => { setTipOpen(false); },
																		onFocus: () => { setTipOpen(true); },
																		onBlur: () => { setTipOpen(false); },
																		children: jsx("svg", {
																			width: 13,
																			height: 13,
																			viewBox: "0 0 16 16",
																			fill: "none",
																			children: jsxs(Fragment, {
																				children: [
																					jsx("circle", { cx: 8, cy: 8, r: 6.5, stroke: "currentColor", strokeWidth: 1.3 }),
																					jsx("path", { d: "M8 5v3.6", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }),
																					jsx("circle", { cx: 8, cy: 11.2, r: 0.9, fill: "currentColor" })
																				]
																			})
																		})
																	})
																]
															})
														]
													})
													: null
											]
										}),
										tipOpen && currentSessionId !== void 0 && conversationCost !== null && formulaLines.length > 0
											? jsx("div", {
												role: "tooltip",
												style: tipBox,
												children: jsxs(Fragment, {
													children: [
														jsx("div", { style: tipTitle, children: `当前对话费用 = ${formatCost(conversationCost, currency)}` }),
														...formulaLines.map((b) => jsxs("div", {
															style: tipRow,
															children: [
																jsx("span", { style: tipLabel, children: b.label }),
																jsx("span", {
																	style: tipFormula,
																	children: `${formatTokens(b.tokens)} tok × ${formatRate(b.rate)} = ${formatCost(b.subtotal, currency)}`
																})
															]
														}, b.label)),
														jsx("div", {
															style: tipFooter,
															children: `合计 ${formatCost(conversationCost, currency)} · 按消息时刻官方价格表计价（含峰谷）`
														})
													]
												})
											})
											: null,
										showMeta
											? jsxs("div", {
												style: metaRow,
												title: "总余额 = 赠送余额 + 充值余额（均为当前剩余）",
												children: [
													showGranted ? jsx("span", { style: metaItem, children: `赠送 ${formatBalance(granted, currency)}` }) : null,
													showGranted && showToppedUp ? jsx("span", { children: "·" }) : null,
													showToppedUp ? jsx("span", { style: metaItem, children: `充值 ${formatBalance(toppedUp, currency)}` }) : null
												]
											})
											: null
									]
								})
					]
				})
			});
		}

		// ---- client plugin body -----------------------------------------
		const inject = ["slots"];

		function apply(ctx) {
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "deepseek-quota",
				order: 100,
				label: "DeepSeek 额度"
			}, DeepSeekQuotaBadge));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

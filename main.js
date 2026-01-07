(() => {
	let lastBlobUrl = null;
	let currentFetchedUrl = ""; // 現在取得しているURLを記録
	let loadStartTime = 0;
	const HISTORY_MAX = 50;

	// ===== LocalStorage ユーティリティ =====
	const Storage = {
		getHistory() {
			try {
				return JSON.parse(localStorage.getItem('likevpn_history') || '[]');
			} catch (e) {
				return [];
			}
		},
		addHistory(url, title = '') {
			const history = this.getHistory();
			const entry = { url, title, time: new Date().toISOString() };
			// 重複排除
			const filtered = history.filter(h => h.url !== url);
			const newHistory = [entry, ...filtered].slice(0, HISTORY_MAX);
			localStorage.setItem('likevpn_history', JSON.stringify(newHistory));
		},
		clearHistory() {
			localStorage.removeItem('likevpn_history');
		},
		getDarkMode() {
			return localStorage.getItem('likevpn_darkmode') === 'true';
		},
		setDarkMode(enabled) {
			localStorage.setItem('likevpn_darkmode', enabled ? 'true' : 'false');
		}
	};

	// ===== DOM ユーティリティ =====
	function applyDarkMode(enabled) {
		const html = document.documentElement;
		if (enabled) {
			html.classList.add('dark-mode');
		} else {
			html.classList.remove('dark-mode');
		}
		Storage.setDarkMode(enabled);
		updateThemeButton();
	}

	function updateThemeButton() {
		const isDark = Storage.getDarkMode();
		const btn = document.getElementById('themeToogleBtn');
		if (btn) {
			btn.textContent = isDark ? '☀️' : '🌙';
			btn.title = isDark ? 'ライトモード' : 'ダークモード';
		}
	}

	function updateHistoryUI() {
		const historyList = document.getElementById('historyList');
		if (!historyList) return;
		
		const history = Storage.getHistory();
		historyList.innerHTML = '';
		
		if (history.length === 0) {
			historyList.innerHTML = '<p style="padding: 20px; text-align: center; opacity: 0.7; font-size: 0.9rem;">履歴はありません</p>';
			return;
		}
		
		history.forEach(item => {
			const el = document.createElement('div');
			el.className = 'history-item fade-in';
			const time = new Date(item.time).toLocaleString('ja-JP');
			el.innerHTML = `
				<div>${item.title || item.url}</div>
				<span class="history-time">${time}</span>
			`;
			el.addEventListener('click', () => {
				document.getElementById('urlInput').value = item.url;
				document.getElementById('fetchContentButton').click();
				document.getElementById('historyToggleBtn').click();
			});
			historyList.appendChild(el);
		});
	}

	function showPageInfo(url, title = '', loadTime = 0) {
		const pageInfoBar = document.getElementById('pageInfoBar');
		const pageTitle = document.getElementById('pageTitle');
		const pageUrl = document.getElementById('pageUrl');
		const loadTimeEl = document.getElementById('loadTime');
		
		if (!pageInfoBar) return;
		
		pageInfoBar.style.display = 'flex';
		if (pageTitle) pageTitle.innerHTML = `<strong>タイトル</strong>${title}`;
		if (pageUrl) pageUrl.innerHTML = `<strong>URL</strong>${url}`;
		if (loadTimeEl && loadTime > 0) loadTimeEl.innerHTML = `<strong>読み込み時間</strong>${loadTime.toFixed(2)}秒`;
	}

	function shareUrl(url) {
		const shareUrl = `${window.location.origin}${window.location.pathname}?url=${encodeURIComponent(url)}`;
		navigator.clipboard.writeText(shareUrl).then(() => {
			alert('URLをクリップボードにコピーしました！');
		}).catch(err => {
			alert('コピーに失敗しました: ' + err);
		});
	}

	function getEndpointBase() {
		const url = new URL(window.location.href);
		const fromQuery = url.searchParams.get("endpoint");
		if (fromQuery) return fromQuery;
		if (typeof window.ENDPOINT_BASE === "string" && window.ENDPOINT_BASE.trim()) {
			return window.ENDPOINT_BASE.trim();
		}
		return ""; // 必要に応じてデフォルト（例: "/proxy"）に変更してください
	}

	function buildRequestUrl(endpointBase, targetUrl) {
	// エンドポイントが ?url= で終わる場合（既にクエリ付き）はそのまま値を連結
	if (endpointBase.endsWith("?url=")) {
	  return `${endpointBase}${encodeURIComponent(targetUrl)}`;
	}
	// そうでない場合は通常のURL構築
		try {
			const u = new URL(endpointBase, window.location.href);
			u.searchParams.set("url", targetUrl);
			return u.toString();
		} catch (e) {
			const sep = endpointBase.includes("?") ? "&" : "?";
			return `${endpointBase}${sep}url=${encodeURIComponent(targetUrl)}`;
		}
	}

	function normalizeResourceUrl(baseUrl, resourcePath) {
		if (!resourcePath) return "";
		try {
			return new URL(resourcePath, baseUrl).href;
		} catch (e) {
			return resourcePath;
		}
	}

	function rewriteResourceUrls(htmlText, baseUrl, endpointBase) {
		let rewritten = htmlText;
		
		// CSS <link> タグのURLをプロキシ経由に変更
		rewritten = rewritten.replace(
			/<link\s+([^>]*?)\s*href=["']([^"']+)["']([^>]*?)>/gi,
			(match, before, href, after) => {
				const absUrl = normalizeResourceUrl(baseUrl, href);
				const proxiedUrl = buildRequestUrl(endpointBase, absUrl);
				return `<link ${before} href="${proxiedUrl}"${after}>`;
			}
		);
		
		// <img> タグのURLをプロキシ経由に変更（遅延読み込み対応）
		rewritten = rewritten.replace(
			/<img\s+([^>]*?)\s*src=["']([^"']+)["']([^>]*?)>/gi,
			(match, before, src, after) => {
				const absUrl = normalizeResourceUrl(baseUrl, src);
				const proxiedUrl = buildRequestUrl(endpointBase, absUrl);
				// loading="lazy" を追加
				if (!after.includes('loading')) {
					return `<img ${before} src="${proxiedUrl}" loading="lazy"${after}>`;
				}
				return `<img ${before} src="${proxiedUrl}"${after}>`;
			}
		);
		
		// <source> タグのsrcsetをプロキシ経由に変更
		rewritten = rewritten.replace(
			/<source\s+([^>]*?)\s*src=["']([^"']+)["']([^>]*?)>/gi,
			(match, before, src, after) => {
				const absUrl = normalizeResourceUrl(baseUrl, src);
				const proxiedUrl = buildRequestUrl(endpointBase, absUrl);
				return `<source ${before} src="${proxiedUrl}"${after}>`;
			}
		);
		
		// @font-face や background-image のURL（インラインスタイル内）をプロキシ経由に変更
		rewritten = rewritten.replace(
			/url\(["']?([^"')]+)["']?\)/g,
			(match, url) => {
				if (url.startsWith('data:') || url.startsWith('blob:')) return match;
				const absUrl = normalizeResourceUrl(baseUrl, url);
				const proxiedUrl = buildRequestUrl(endpointBase, absUrl);
				return `url(${proxiedUrl})`;
			}
		);
		
		return rewritten;
	}

	function renderHtmlInSandbox(htmlText, container) {
		// 前回のBlobURLをクリーンアップ
		if (lastBlobUrl) {
			URL.revokeObjectURL(lastBlobUrl);
		}

		container.innerHTML = "";
		
		const endpointBase = getEndpointBase();
		
		// 外部スクリプトの参照エラーを防ぐため、一般的なグローバル変数をスタブとして定義
		const globalStubs = `
			window.GOOGLE_ANALYTICS_ID = window.GOOGLE_ANALYTICS_ID || undefined;
			window.ga = window.ga || function() {};
			window.gtag = window.gtag || function() {};
			window.dataLayer = window.dataLayer || [];
			window.console = window.console || { log: function() {}, error: function() {}, warn: function() {} };
		`;
		
		// 危険なスクリプトを削除（外部広告やトラッキング）
		let cleanedHtml = htmlText;
		cleanedHtml = cleanedHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
		cleanedHtml = cleanedHtml.replace(/on\w+\s*=\s*["'][^"']*["']/gi, ''); // インラインイベントハンドラも削除
		
		// リソースURL（画像、CSS、フォント）をプロキシ経由に書き換え
		cleanedHtml = rewriteResourceUrls(cleanedHtml, currentFetchedUrl, endpointBase);
		
		// スタイルを強化し、レスポンシブメタタグを保証するHTMLを構築
		const enhancedHtml = `
<!DOCTYPE html>
<html lang="ja">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		html, body { width: 100%; height: auto; }
		body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
		img { max-width: 100%; height: auto; display: block; }
		video, iframe { max-width: 100%; height: auto; }
		table { border-collapse: collapse; width: 100%; margin: 1em 0; }
		td, th { padding: 8px; border: 1px solid #ddd; }
		th { background: #f5f5f5; font-weight: 600; }
		a { color: #667eea; text-decoration: none; }
		a:hover { text-decoration: underline; }
		code, pre { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: 'Courier New', monospace; }
		pre { padding: 12px; overflow-x: auto; }
	</style>
</head>
<body>
	${cleanedHtml}
	<script>${globalStubs}</script>
</body>
</html>
	`;

		const blob = new Blob([enhancedHtml], { type: "text/html;charset=utf-8" });
		lastBlobUrl = URL.createObjectURL(blob);
		
		const iframe = document.createElement("iframe");
		// allow-same-origin を削除してセキュリティを強化
		iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-popups");
		iframe.setAttribute("loading", "lazy");
		iframe.style.width = "100%";
		iframe.style.border = "none";
		iframe.style.borderRadius = "8px";
		iframe.style.backgroundColor = "#fff";
		iframe.style.minHeight = "70vh";
		iframe.style.display = "block";
		
		// ローディング表示
		const loaderEl = document.createElement("div");
		loaderEl.style.cssText = `
			position: absolute;
			top: 50%;
			left: 50%;
			transform: translate(-50%, -50%);
			font-size: 0.9rem;
			color: #667eea;
			font-weight: 600;
			pointer-events: none;
		`;
		loaderEl.textContent = "読み込み中…";
		
		const wrapper = document.createElement("div");
		wrapper.style.cssText = `
			position: relative;
			animation: fadeIn 0.3s ease-in-out;
		`;
		wrapper.appendChild(iframe);
		wrapper.appendChild(loaderEl);
		
		let iframeLoaded = false;
		let contentHeightChecked = false;
		
		const onLoad = () => {
			iframeLoaded = true;
			loaderEl.style.display = "none";
			wrapper.style.animation = "none";
			// レイアウトシフトを防ぐため、iframeの高さを自動調整
			if (!contentHeightChecked) {
				contentHeightChecked = true;
				try {
					// 複数回チェックして最終的な高さを捉える
					const checkHeight = () => {
						try {
							const contentHeight = iframe.contentDocument?.documentElement.scrollHeight || 500;
							const newHeight = Math.max(contentHeight + 20, 400);
							iframe.style.minHeight = newHeight + "px";
						} catch (e) {
							// クロスオリジンの場合は調整不可
						}
					};
					checkHeight();
					setTimeout(checkHeight, 300);
					setTimeout(checkHeight, 800);
				} catch (e) {
					// クロスオリジンの場合は調整不可
				}
			}
		};

		const onError = () => {
			loaderEl.textContent = "読み込みエラーが発生しました";
			loaderEl.style.color = "#d32f2f";
		};

		iframe.onload = onLoad;
		iframe.onerror = onError;
		
		// タイムアウト処理（20秒で強制終了）
		setTimeout(() => {
			if (!iframeLoaded) {
				loaderEl.textContent = "読み込みがタイムアウトしました";
				loaderEl.style.color = "#f57c00";
			}
		}, 20000);

		iframe.src = lastBlobUrl;
		container.appendChild(wrapper);
	}

	function setLoading(state, buttonEl) {
		if (!buttonEl) return;
		buttonEl.disabled = !!state;
		buttonEl.textContent = state ? "読み込み中…" : "コンテンツの取得";
		buttonEl.style.opacity = state ? "0.7" : "1";
	}

	function setMessage(container, message, type = "info") {
		container.innerHTML = `<div style="padding: 20px; text-align: center; font-weight: 500; color: ${
			type === "error" ? "#d32f2f" : 
			type === "success" ? "#388e3c" : 
			"#667eea"
		};">${message}</div>`;
	}

	function detectMetaRedirect(htmlText) {
		const match = htmlText.match(/<meta\s+http-equiv=["']?refresh["']?\s+content=["']([^"']+)["']\s*\/?>/i);
		if (!match || !match[1]) return null;
		const content = match[1];
		const urlMatch = content.match(/url\s*=\s*["']?([^"';]+)["']?/i);
		return urlMatch ? urlMatch[1].trim() : null;
	}

	function isAbsoluteUrl(url) {
		if (!url) return false;
		try {
			new URL(url);
			return true;
		} catch {
			return false;
		}
	}

	function normalizeUrl(input) {
		try {
			// 相対指定等にも耐えるように現在のオリジンを基準に解決
			return new URL(input, window.location.origin).href;
		} catch (e) {
			return null;
		}
	}

	document.addEventListener("DOMContentLoaded", () => {
		const inputEl = document.getElementById("urlInput");
		const buttonEl = document.getElementById("fetchContentButton");
		const displayEl = document.getElementById("contentDisplay");
		if (!inputEl || !buttonEl || !displayEl) return;

		// URLクエリパラメータから初期値を取得
		const urlParams = new URLSearchParams(window.location.search);
		const initialUrl = urlParams.get('url');
		if (initialUrl) {
			inputEl.value = initialUrl;
		}

		// ダークモード初期化
		if (Storage.getDarkMode()) {
			applyDarkMode(true);
		}
		updateHistoryUI();

		// ===== イベントリスナー登録 =====

		// テーマ切り替え
		document.getElementById('themeToogleBtn')?.addEventListener('click', () => {
			const isDark = !Storage.getDarkMode();
			applyDarkMode(isDark);
		});

		// キャッシュクリア
		document.getElementById('clearCacheBtn')?.addEventListener('click', () => {
			if (confirm('キャッシュをクリアしてもよろしいですか？')) {
				// 現在のiframeをクリア
				displayEl.innerHTML = '<div class="message-container info">キャッシュをクリアしました</div>';
				setTimeout(() => {
					displayEl.innerHTML = '';
				}, 1500);
			}
		});

		// URL共有
		document.getElementById('shareUrlBtn')?.addEventListener('click', () => {
			const url = inputEl.value.trim();
			if (!url) {
				alert('URLを入力してください');
				return;
			}
			shareUrl(url);
		});

		// 履歴パネル切り替え
		const historySidebar = document.getElementById('historySidebar');
		document.getElementById('historyToggleBtn')?.addEventListener('click', () => {
			historySidebar?.classList.toggle('open');
		});

		document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
			if (confirm('履歴をすべて削除してもよろしいですか？')) {
				Storage.clearHistory();
				updateHistoryUI();
			}
		});

		// ツールバーボタン
		document.getElementById('reloadBtn')?.addEventListener('click', () => {
			if (currentFetchedUrl) {
				inputEl.value = currentFetchedUrl;
				buttonEl.click();
			}
		});

		document.getElementById('fullscreenBtn')?.addEventListener('click', () => {
			const contentArea = document.querySelector('.content-area');
			if (!contentArea) return;
			
			if (!document.fullscreenElement) {
				contentArea.requestFullscreen?.().catch(err => {
					console.log('フルスクリーン要求エラー:', err);
				});
			} else {
				document.exitFullscreen?.();
			}
		});

		const fetchContent = async () => {
			const raw = (inputEl.value || "").trim();
			if (!raw) {
				setMessage(displayEl, "URLを入力してください。", "info");
				return;
			}

			const normalized = normalizeUrl(raw);
			if (!normalized) {
				setMessage(displayEl, "正しいURL形式で入力してください。", "error");
				return;
			}

			const endpointBase = getEndpointBase();
			if (!endpointBase) {
				setMessage(displayEl, "エンドポイントが未設定です。?endpoint=... または window.ENDPOINT_BASE を設定してください。", "error");
				return;
			}

			loadStartTime = performance.now();

			try {
				setLoading(true, buttonEl);
				setMessage(displayEl, "読み込み中…", "info");
				
				let currentUrl = normalized;
				let redirectCount = 0;
				const maxRedirects = 3;
				
				while (redirectCount <= maxRedirects) {
					const requestUrl = buildRequestUrl(endpointBase, currentUrl);
					const res = await fetch(requestUrl, { 
						method: "GET",
						redirect: "follow" 
					});
					const text = await res.text();
					
					if (!res.ok) {
						throw new Error(`HTTP ${res.status}`);
					}
					
					// メタリダイレクトを検出
					const redirectUrl = detectMetaRedirect(text);
					
					if (redirectUrl && redirectCount < maxRedirects) {
						const resolvedUrl = isAbsoluteUrl(redirectUrl) 
							? redirectUrl 
							: new URL(redirectUrl, currentUrl).href;
						
						currentUrl = resolvedUrl;
						redirectCount++;
						setMessage(displayEl, `リダイレクト中 (${redirectCount}/${maxRedirects})…`, "info");
						continue;
					}
					
					// 最終的に取得したURLを記録（リソースURL書き換え用）
					currentFetchedUrl = currentUrl;
					
					// 履歴に追加
					const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
					const pageTitle = titleMatch ? titleMatch[1] : '';
					Storage.addHistory(currentUrl, pageTitle);
					updateHistoryUI();
					
					// 読み込み時間を計算
					const loadTime = (performance.now() - loadStartTime) / 1000;
					showPageInfo(currentUrl, pageTitle, loadTime);
					
					// リダイレクト完了またはリダイレクトなし
					if (redirectCount > 0) {
						setMessage(displayEl, `✓ リダイレクト完了 (${currentUrl})`, "success");
						setTimeout(() => {
							renderHtmlInSandbox(text, displayEl);
						}, 1000);
					} else {
						renderHtmlInSandbox(text, displayEl);
					}
					break;
				}
				
				if (redirectCount >= maxRedirects) {
					setMessage(displayEl, `最大リダイレクト数 (${maxRedirects}) に達しました。`, "error");
				}
			} catch (err) {
				const errorMsg = err && err.message ? err.message : String(err);
				setMessage(displayEl, `取得に失敗しました: ${errorMsg}`, "error");
			} finally {
				setLoading(false, buttonEl);
			}
		};

		buttonEl.addEventListener("click", fetchContent);
		
		// Enter キーで送信対応
		inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				fetchContent();
			}
		});

		// 初期URLクエリがあれば自動読み込み
		if (initialUrl) {
			setTimeout(() => buttonEl.click(), 500);
		}
	});
})();


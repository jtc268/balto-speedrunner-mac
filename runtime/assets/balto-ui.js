(() => {
  const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
  const speedEndpoint = LOCAL_HOSTS.has(location.hostname)
    ? 'http://127.0.0.1:30100/speed'
    : `https://${location.hostname}:30100/speed`

  document.title = 'Balto Speedrunner'

  function openFreshSession() {
    if (new URLSearchParams(location.search).get('balto') !== 'new') return
    history.replaceState(null, '', `${location.pathname}${location.hash}`)

    const startedAt = Date.now()
    const tryOpen = () => {
      const button = [...document.querySelectorAll('button[aria-label]')].find((candidate) => {
        const label = candidate.getAttribute('aria-label') || ''
        return /^(new session|new chat)$/i.test(label) || label.includes('新建会话')
      })
      if (button) {
        button.click()
        return
      }
      if (Date.now() - startedAt < 30000) setTimeout(tryOpen, 100)
    }
    tryOpen()
  }

  let testingNoticeDismissed = false
  function dismissInternalTestingNotice() {
    if (testingNoticeDismissed) return
    const dialog = [...document.querySelectorAll('[role="dialog"], dialog')].find((candidate) =>
      /Internal Testing Notice/i.test(candidate.textContent || ''),
    )
    if (!dialog) return
    const continueButton = [...dialog.querySelectorAll('button')].find((candidate) =>
      /^Continue$/i.test((candidate.textContent || '').trim()),
    )
    if (!continueButton) return
    testingNoticeDismissed = true
    continueButton.click()
  }

  function brandVisibleWorkspace() {
    const wordmark = [...document.querySelectorAll('button[aria-label]')].find((candidate) =>
      candidate.querySelector(':scope > svg[viewBox="0 0 182 24"]'),
    )
    if (wordmark && !wordmark.dataset.baltoBrand) {
      wordmark.dataset.baltoBrand = 'true'
      const icon = document.createElement('img')
      icon.src = '/assets/balto-mark.svg'
      icon.alt = ''
      const name = document.createElement('span')
      name.className = 'balto-sidebar-name'
      name.textContent = 'Balto'
      const label = document.createElement('span')
      label.className = 'balto-sidebar-label'
      label.textContent = 'Speedrunner'
      const text = document.createElement('span')
      text.className = 'balto-sidebar-wordmark'
      text.append(name, label)
      wordmark.replaceChildren(icon, text)
    }

    const heroText = [...document.querySelectorAll('span')].find((candidate) =>
      (candidate.textContent || '').trim() === 'Into the Unknown',
    )
    if (heroText) {
      heroText.textContent = 'Ready to run'
      const hero = heroText.parentElement
      const iconContainer = hero?.querySelector('span:has(> svg)')
      if (iconContainer && !iconContainer.dataset.baltoHero) {
        iconContainer.dataset.baltoHero = 'true'
        const icon = document.createElement('img')
        icon.src = '/assets/balto-mark.svg'
        icon.alt = ''
        iconContainer.replaceChildren(icon)
      }
    }
  }

  function simplifyEffortControls() {
    for (const trigger of document.querySelectorAll('button[aria-label^="Select model"]')) {
      const root = trigger.parentElement
      if (!root) continue
      trigger.style.display = 'none'
      if (root.querySelector(':scope > .balto-static-model')) continue
      const staticModelLabel = document.createElement('span')
      staticModelLabel.className = 'balto-static-model'
      staticModelLabel.textContent = 'Qwen 3.8 27B'
      staticModelLabel.title = 'Qwen 3.8 27B Optimized Speed'
      root.append(staticModelLabel)
    }

    for (const effort of document.querySelectorAll('[class*="triggerEffort"]')) {
      effort.style.display = 'none'
      const trigger = effort.closest('button')
      if (!trigger) continue
      trigger.title = (trigger.title || '').replace(/\s+\S+\s+(?:Off|Low|Medium|High)\s*$/i, '')
      trigger.setAttribute(
        'aria-label',
        (trigger.getAttribute('aria-label') || '').replace(/,?\s*reasoning effort (?:Off|Low|Medium|High)\s*$/i, ''),
      )
    }

    for (const label of document.querySelectorAll('[class*="cellLabel"]')) {
      if ((label.textContent || '').trim() !== 'Effort') continue
      const row = label.closest('[role="menuitem"]')
      if (row) row.style.display = 'none'
    }
  }

  const mobileSidebarQuery = window.matchMedia('(max-width: 720px)')
  function syncMobileSidebar() {
    const sidebar = document.querySelector('.hHd-Xa_root')
    const isOpen = mobileSidebarQuery.matches
      && Boolean(sidebar?.querySelector('button[aria-label="Collapse sidebar"]'))
    document.body.classList.toggle('balto-mobile-sidebar-open', isOpen)

    let backdrop = document.querySelector('#balto-mobile-sidebar-backdrop')
    if (!isOpen) {
      backdrop?.remove()
      return
    }
    if (backdrop) return

    backdrop = document.createElement('button')
    backdrop.id = 'balto-mobile-sidebar-backdrop'
    backdrop.type = 'button'
    backdrop.setAttribute('aria-label', 'Close sidebar')
    backdrop.addEventListener('click', () => {
      document.querySelector('.hHd-Xa_root button[aria-label="Collapse sidebar"]')?.click()
    })
    document.body.append(backdrop)
  }
  mobileSidebarQuery.addEventListener?.('change', syncMobileSidebar)

  let attachmentTarget = null
  function findPromptBox() {
    return document.querySelector('textarea[placeholder="Message the agent"], textarea[placeholder*="Ask anything"], textarea')
  }

  function attachmentInput() {
    let input = document.querySelector('#balto-attachment-input')
    if (input) return input

    input = document.createElement('input')
    input.id = 'balto-attachment-input'
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp,image/gif'
    input.multiple = true
    input.tabIndex = -1
    input.setAttribute('aria-hidden', 'true')
    input.addEventListener('change', () => {
      const files = [...(input.files || [])]
      const target = attachmentTarget?.isConnected ? attachmentTarget : findPromptBox()
      attachmentTarget = null
      input.value = ''
      if (!target || files.length === 0) return

      const clipboardData = {
        files,
        items: files.map((file) => ({
          kind: 'file',
          type: file.type,
          getAsFile: () => file,
        })),
        types: ['Files'],
        getData: () => '',
      }
      const paste = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(paste, 'clipboardData', { value: clipboardData })
      target.dispatchEvent(paste)
      target.focus({ preventScroll: true })
    })
    document.body.append(input)
    return input
  }

  function openAttachmentPicker(event) {
    event.preventDefault()
    event.stopPropagation()
    attachmentTarget = findPromptBox()
    attachmentInput().click()
    document.querySelector('button[data-balto-add="true"][aria-expanded="true"]')?.click()
  }

  function mountAttachmentControl() {
    for (const trigger of document.querySelectorAll('button[aria-label="Commands"], button[data-balto-add="true"]')) {
      trigger.dataset.baltoAdd = 'true'
      trigger.setAttribute('aria-label', 'Add')
      trigger.title = 'Add'
    }

    for (const tooltip of document.querySelectorAll('[role="tooltip"]')) {
      if ((tooltip.textContent || '').trim() === 'Commands') tooltip.textContent = 'Add'
    }

    for (const menu of document.querySelectorAll('[role="listbox"][aria-label="Trigger suggestions"]')) {
      if (menu.querySelector('[data-balto-attachment-option]')) continue
      const viewport = menu.firstElementChild
      const commandsTitle = viewport?.querySelector('[role="presentation"][data-source="command"]')
      const firstOption = viewport?.querySelector('[role="option"]')
      if (!viewport || !commandsTitle || !firstOption) continue

      const addTitle = commandsTitle.cloneNode(true)
      addTitle.textContent = 'Add'
      addTitle.dataset.source = 'balto-attachment'

      const option = document.createElement('button')
      option.type = 'button'
      option.role = 'option'
      option.className = `${firstOption.className.replace(/\s*\S*active\S*/g, '')} balto-attachment-option`
      option.dataset.baltoAttachmentOption = 'true'
      option.setAttribute('aria-selected', 'false')
      option.setAttribute('aria-label', 'Attach file')
      const optionParts = [...firstOption.children]
      const nameClass = optionParts[0]?.className || ''
      const descriptionClass = optionParts[1]?.className || ''
      option.innerHTML = `
        <span class="balto-attachment-paperclip" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M9.5 12.5 15.9 6a3.2 3.2 0 0 1 4.6 4.5l-8.7 8.8a5 5 0 0 1-7.1-7.1l8.4-8.4a2.8 2.8 0 0 1 4 4l-8.4 8.4a.9.9 0 1 1-1.3-1.3l7.6-7.6"/></svg>
        </span>
        <span class="${nameClass}">Attach file</span>
        <span class="${descriptionClass}">PNG, JPG, WebP, or GIF</span>
      `
      option.addEventListener('mousedown', (event) => event.preventDefault())
      option.addEventListener('click', openAttachmentPicker)
      viewport.insertBefore(addTitle, commandsTitle)
      viewport.insertBefore(option, commandsTitle)
    }
  }

  openFreshSession()
  dismissInternalTestingNotice()
  brandVisibleWorkspace()
  simplifyEffortControls()
  syncMobileSidebar()
  mountAttachmentControl()

  const style = document.createElement('style')
  style.textContent = `
    button[aria-label^="Select model"] {
      display: none !important;
    }
    .balto-static-model {
      display: inline-flex !important;
      align-items: center;
      min-width: 0;
      padding: 0 4px;
      white-space: nowrap;
      color: inherit;
      font: inherit;
      font-weight: 550;
      opacity: .78;
      user-select: none;
    }
    #balto-live-bar {
      --balto-speed: #54df9b;
      position: fixed;
      z-index: 2147483646;
      top: 8px;
      right: 18px;
      height: 48px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 13px 0 9px;
      border: 1px solid rgba(255,255,255,.09);
      border-radius: 15px;
      background: linear-gradient(145deg, rgba(35,39,45,.94), rgba(18,20,24,.95));
      box-shadow: 0 10px 28px rgba(0,0,0,.26);
      backdrop-filter: blur(18px);
      color: #f5f7f8;
      font-family: Inter, "Segoe UI", sans-serif;
      user-select: none;
    }
    #balto-live-bar .balto-sprinter { width: 35px; height: 30px; position: relative; display: grid; place-items: center; overflow: visible; }
    #balto-live-bar .balto-sprinter img { position: relative; z-index: 1; width: 29px; height: 29px; transform-origin: 50% 72%; animation: balto-sprint 1.15s ease-in-out infinite; }
    #balto-live-bar .balto-sprinter::before,
    #balto-live-bar .balto-sprinter::after { content: ""; position: absolute; right: 26px; height: 2px; border-radius: 2px; background: var(--balto-speed); opacity: .28; transform-origin: right center; animation: balto-trail 1.15s ease-in-out infinite; }
    #balto-live-bar .balto-sprinter::before { top: 10px; width: 13px; }
    #balto-live-bar .balto-sprinter::after { top: 19px; width: 9px; animation-delay: -.18s; }
    #balto-live-bar[data-state="live"] .balto-sprinter img { animation-duration: .42s; }
    #balto-live-bar[data-state="live"] .balto-sprinter::before,
    #balto-live-bar[data-state="live"] .balto-sprinter::after { opacity: .7; animation-duration: .42s; }
    #balto-live-bar[data-state="idle"] .balto-sprinter::before,
    #balto-live-bar[data-state="idle"] .balto-sprinter::after { opacity: .12; }
    #balto-live-bar .balto-meter { min-width: 96px; display: flex; align-items: baseline; justify-content: flex-end; gap: 6px; }
    #balto-live-bar .balto-value { color: var(--balto-speed); font: 650 26px/1 "Cascadia Code", Consolas, monospace; letter-spacing: -1.6px; font-variant-numeric: tabular-nums; text-shadow: 0 0 18px color-mix(in srgb, var(--balto-speed) 18%, transparent); }
    #balto-live-bar .balto-unit { color: rgba(245,247,248,.58); font-size: 8px; font-weight: 800; letter-spacing: 1px; }
    #balto-live-bar[data-state="idle"] .balto-value { color: #707780; text-shadow: none; }
    @keyframes balto-sprint { 0%, 100% { transform: translateY(1px) rotate(-1deg); } 50% { transform: translateY(-2px) rotate(1deg); } }
    @keyframes balto-trail { 0%, 100% { transform: scaleX(.45); opacity: .16; } 50% { transform: scaleX(1); opacity: .72; } }
    [data-balto-brand="true"] { width: auto !important; display: inline-flex !important; align-items: center !important; gap: 9px !important; color: #f5f7f8 !important; }
    [data-balto-brand="true"] > img { width: 27px !important; height: 27px !important; flex: 0 0 27px; }
    .balto-sidebar-wordmark { display: flex; align-items: baseline; gap: 7px; white-space: nowrap; font-family: Inter, "Segoe UI", sans-serif; }
    .balto-sidebar-name { font-size: 15px; font-weight: 760; letter-spacing: -.3px; }
    .balto-sidebar-label { color: rgba(245,247,248,.48); font-size: 7px; font-weight: 850; letter-spacing: 1.35px; text-transform: uppercase; }
    #balto-attachment-input { position: fixed !important; width: 1px !important; height: 1px !important; inset: auto auto 0 0 !important; opacity: 0 !important; pointer-events: none !important; }
    .balto-attachment-option { width: 100%; }
    .balto-attachment-paperclip { width: 18px; height: 18px; flex: 0 0 18px; display: inline-flex; align-items: center; justify-content: center; color: #72dba5; }
    .balto-attachment-paperclip svg { width: 17px; height: 17px; overflow: visible; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    [data-balto-hero="true"] { display: inline-flex !important; align-items: center; justify-content: center; }
    [data-balto-hero="true"] > img { width: 31px !important; height: 31px !important; }
    [class*="_previewBadge"] {
      display: none !important;
    }
    #balto-mobile-sidebar-backdrop { display: none; }
    @media (max-width: 720px) {
      html, body, #root { width: 100%; min-width: 0; overflow: hidden; }
      .pI_x6G_frame { grid-template-columns: 0 minmax(0, 1fr) 0 !important; }
      .pI_x6G_sidebarCol { position: relative; z-index: 1201; overflow: visible !important; }
      .pI_x6G_detailsCol, .pI_x6G_handle { display: none !important; }
      .hHd-Xa_root {
        position: fixed !important;
        z-index: 1202;
        inset: 0 auto 0 0;
        width: min(86vw, 320px) !important;
        height: 100dvh !important;
        padding: max(8px, env(safe-area-inset-top)) 12px max(8px, env(safe-area-inset-bottom)) !important;
        border-right: 1px solid rgba(255,255,255,.1);
        box-shadow: 24px 0 70px rgba(0,0,0,.46);
      }
      .hHd-Xa_root.hHd-Xa_collapsed {
        inset: max(8px, env(safe-area-inset-top)) auto auto max(8px, env(safe-area-inset-left));
        width: 44px !important;
        height: 44px !important;
        min-height: 44px !important;
        padding: 4px !important;
        overflow: visible !important;
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 14px;
        background: rgba(27,30,35,.94);
        box-shadow: 0 8px 28px rgba(0,0,0,.3);
        backdrop-filter: blur(16px);
      }
      .hHd-Xa_collapsed > :not(.hHd-Xa_logoRow) { display: none !important; }
      .hHd-Xa_collapsed .hHd-Xa_logoRow { width: 36px; height: 36px; margin: 0; padding: 0; overflow: visible; }
      .hHd-Xa_collapsed .hHd-Xa_toggle { width: 36px !important; height: 36px !important; }
      .hHd-Xa_root:not(.hHd-Xa_collapsed) .hHd-Xa_logoRow { position: relative; z-index: 1; height: 52px; margin: 0 0 8px; padding: 4px 0; }
      .hHd-Xa_root:not(.hHd-Xa_collapsed) .hHd-Xa_toggle { width: 40px; height: 40px; }
      #balto-mobile-sidebar-backdrop {
        position: fixed;
        z-index: 1200;
        inset: 0;
        display: block;
        width: 100vw;
        height: 100dvh;
        padding: 0;
        border: 0;
        background: rgba(0,0,0,.58);
        cursor: default;
      }
      #balto-live-bar {
        top: max(8px, env(safe-area-inset-top));
        right: max(8px, env(safe-area-inset-right)) !important;
        height: 44px;
        gap: 5px;
        padding: 0 9px 0 6px;
        border-radius: 14px;
        pointer-events: none;
        transition: opacity .16s ease, transform .16s ease;
      }
      body.balto-mobile-sidebar-open #balto-live-bar { opacity: 0; transform: translateY(-8px); }
      #balto-live-bar .balto-sprinter { width: 28px; height: 26px; }
      #balto-live-bar .balto-sprinter img { width: 25px; height: 25px; }
      #balto-live-bar .balto-sprinter::before, #balto-live-bar .balto-sprinter::after { right: 22px; }
      #balto-live-bar .balto-meter { min-width: 64px; gap: 4px; }
      #balto-live-bar .balto-value { font-size: 20px; letter-spacing: -1px; }
      #balto-live-bar .balto-unit { font-size: 7px; letter-spacing: .5px; }
      .wSkVaW_root { --dsh-chat-content-width: 100%; --dsh-composer-card-max-width: 100%; --dsh-composer-side-clearance: 8px; }
      .wSkVaW_header { position: relative; min-height: 88px !important; padding: 0 !important; }
      .wSkVaW_titleRow { display: none !important; }
      .wSkVaW_tabs { position: absolute !important; right: 0; bottom: 8px; left: 0; width: 100%; margin: 0 !important; padding: 0 !important; justify-content: center !important; gap: 32px !important; }
      .Md3f7G_scroll { padding: 12px 16px; }
      .uV2eYG_root { padding: 0 8px calc(8px + env(safe-area-inset-bottom)); }
      .uV2eYG_card { gap: 8px; border-radius: 18px; }
      .uV2eYG_input, .uV2eYG_mirror, .uV2eYG_backdrop { font-size: 16px; padding-inline: 13px; }
      .uV2eYG_row { min-width: 0; gap: 6px; padding: 2px 6px 6px; }
      .uV2eYG_tools { flex: 0 0 auto; gap: 8px; }
      .uV2eYG_modes, .uV2eYG_trailing { min-width: 0; gap: 6px; }
      .uV2eYG_trailing { flex: 1 1 auto; justify-content: flex-end; }
      ._7KE1Ra_root { min-width: 0; max-width: 118px; }
      ._7KE1Ra_trigger { width: 100% !important; min-width: 0; max-width: 100% !important; overflow: hidden; }
      ._7KE1Ra_triggerLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      ._7KE1Ra_menu { right: -46px !important; left: auto !important; max-width: calc(100vw - 24px) !important; }
      .uV2eYG_select { max-width: 136px; padding-left: 5px; }
      [role="tooltip"] { display: none !important; }
      .balto-attachment-option { min-height: 44px; }
      .VOzbGW_overlay { align-items: stretch !important; padding: 0 !important; }
      .VOzbGW_panel { width: 100vw !important; max-width: none !important; height: 100dvh !important; max-height: none !important; border-radius: 0 !important; flex-direction: column !important; }
      .VOzbGW_nav { width: 100% !important; flex: 0 0 auto !important; gap: 8px !important; padding: max(10px, env(safe-area-inset-top)) 10px 0 !important; }
      .VOzbGW_navTitle { display: none; }
      .VOzbGW_navList { width: 100% !important; min-height: 46px; flex-direction: row !important; gap: 4px !important; padding-bottom: 8px !important; overflow-x: auto !important; overflow-y: hidden !important; scrollbar-width: none; }
      .VOzbGW_navList::-webkit-scrollbar { display: none; }
      .VOzbGW_navCell { width: auto !important; flex: 0 0 auto !important; height: 38px !important; padding: 8px 11px !important; }
      .VOzbGW_content { min-height: 0 !important; flex: 1 1 auto !important; }
      .VOzbGW_header { height: 48px !important; padding: 8px 10px !important; }
      .VOzbGW_options { min-height: 0 !important; padding: 0 16px calc(20px + env(safe-area-inset-bottom)) !important; overscroll-behavior: contain; }
    }
    @media (max-width: 360px) {
      #balto-live-bar { padding-right: 7px; }
      #balto-live-bar .balto-meter { min-width: 56px; }
      #balto-live-bar .balto-value { font-size: 18px; }
      .Md3f7G_scroll { padding-inline: 12px; }
      .uV2eYG_root { padding-inline: 6px; }
      .uV2eYG_tools { gap: 4px; }
      ._7KE1Ra_root { max-width: 88px; }
    }
    @media (prefers-reduced-motion: reduce) {
      #balto-live-bar .balto-sprinter img,
      #balto-live-bar .balto-sprinter::before,
      #balto-live-bar .balto-sprinter::after { animation: none !important; }
    }
  `
  document.head.append(style)

  const bar = document.createElement('div')
  bar.id = 'balto-live-bar'
  bar.dataset.state = 'idle'
  bar.innerHTML = `
    <div class="balto-sprinter" aria-hidden="true"><img src="/assets/balto-mark.svg" alt=""></div>
    <div class="balto-meter"><span class="balto-value">0</span><span class="balto-unit">TOK/S</span></div>
  `
  document.body.append(bar)

  function positionSpeedBar() {
    const exportButton = [...document.querySelectorAll('button')].find((candidate) =>
      /^Session log\b/i.test((candidate.textContent || '').trim()),
    )
    const right = exportButton
      ? Math.max(window.innerWidth - exportButton.getBoundingClientRect().left + 12, 18)
      : 18
    bar.style.right = `${right}px`
  }
  positionSpeedBar()
  window.addEventListener('resize', positionSpeedBar)

  const value = bar.querySelector('.balto-value')
  let shown = 0
  let target = 0
  function animate() {
    shown += (target - shown) * 0.22
    if (Math.abs(target - shown) < 0.08) shown = target
    value.textContent = shown >= 100 ? shown.toFixed(0) : shown.toFixed(1)
    requestAnimationFrame(animate)
  }
  animate()

  async function poll() {
    try {
      const response = await fetch(speedEndpoint, { cache: 'no-store' })
      const data = await response.json()
      target = Number(data.tokensPerSecond || 0)
      bar.dataset.state = data.state === 'live' ? 'live' : target > 0 ? 'complete' : 'idle'
      bar.style.setProperty('--balto-speed', target >= 200 ? '#54df9b' : target >= 100 ? '#70d8ff' : target > 0 ? '#ffcc66' : '#707780')
    } catch {
      bar.dataset.state = 'idle'
    }
  }
  poll()
  setInterval(poll, 300)

  const replacements = new Map([
    ['DeepSeek Harness', 'Balto Speedrunner'],
    ['DeepSeek-Harness', 'Balto Speedrunner'],
    ['deepseek_harness', 'Balto'],
    ['@deepseek-ai/dsh-system-prompt', 'Balto system prompt'],
  ])
  function replaceText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      let next = node.nodeValue
      for (const [from, to] of replacements) next = next.split(from).join(to)
      if (next !== node.nodeValue) node.nodeValue = next
    }
  }
  replaceText(document.body)
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') replaceText(mutation.target.parentNode)
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) replaceText(node.parentNode)
        else if (node.nodeType === Node.ELEMENT_NODE) replaceText(node)
      }
    }
    dismissInternalTestingNotice()
    brandVisibleWorkspace()
    simplifyEffortControls()
    syncMobileSidebar()
    mountAttachmentControl()
    requestAnimationFrame(positionSpeedBar)
  }).observe(document.body, { childList: true, characterData: true, subtree: true })
})()

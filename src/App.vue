<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import alleyScene from './assets/alley-scene.png'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '')
const USER_STORAGE_KEY = 'namiyaCurrentUser'
const ADMIN_ACCOUNT_STORAGE_KEY = 'namiyaAdminAccount'
const ADMIN_TOKEN_STORAGE_KEY = 'namiyaAdminToken'
const USER_REPLY_SEEN_PREFIX = 'namiyaSeenReplies:'

const appView = ref('public')
const currentPage = ref('home')
const worry = ref('')
const hasSubmitted = ref(false)
const isSubmitting = ref(false)
const submitError = ref('')
const showLogin = ref(false)
const authMode = ref('login')
const loginAccount = ref('')
const loginPassword = ref('')
const authError = ref('')
const authSuccess = ref('')
const isAuthSubmitting = ref(false)
const currentUser = ref('')
const adminSession = ref('')
const adminLetters = ref([])
const adminError = ref('')
const adminSuccess = ref('')
const isAdminLoading = ref(false)
const adminSearch = ref('')
const adminStatusFilter = ref('all')
const adminSortOrder = ref('newest')
const activeReplyId = ref('')
const replyDraft = ref('')
const isReplySubmitting = ref(false)
const letterHistory = ref([])
const historyError = ref('')
const isHistoryLoading = ref(false)
const expandedLetter = ref(null)
const unreadReplyIds = ref([])
const noticeMessage = ref('')
const noticeTone = ref('info')
const adminKnownLetterIds = ref([])
let userPollingTimer = 0
let adminPollingTimer = 0
let noticeTimer = 0

function getReplyTimestamp(letter) {
  return new Date(letter.repliedAt || letter.createdAt).getTime()
}

function getLetterTimestamp(letter) {
  return new Date(letter.createdAt).getTime()
}

const filteredAdminLetters = computed(() => {
  const keyword = adminSearch.value.trim().toLowerCase()
  const letters = adminLetters.value.filter((letter) => {
    const accountName = (letter.accountName || '未登入旅人').toLowerCase()
    const matchesKeyword = !keyword || accountName.includes(keyword)
    const matchesStatus =
      adminStatusFilter.value === 'all'
      || (adminStatusFilter.value === 'replied' && letter.status === 'replied')
      || (adminStatusFilter.value === 'pending' && letter.status !== 'replied')

    return matchesKeyword && matchesStatus
  })

  return [...letters].sort((left, right) => {
    const diff = getLetterTimestamp(left) - getLetterTimestamp(right)
    return adminSortOrder.value === 'oldest' ? diff : -diff
  })
})

const replyLetters = computed(() =>
  [...letterHistory.value]
    .filter((item) => item.reply)
    .sort((left, right) => getReplyTimestamp(right) - getReplyTimestamp(left))
)

const latestReply = computed(() => replyLetters.value[0] || null)

const unreadReplyCount = computed(() => unreadReplyIds.value.length)
const topbarLabel = computed(() => {
  if (currentUser.value) {
    return '登出'
  }

  if (adminSession.value) {
    return '管理頁'
  }

  return '登入'
})

function getSeenReplyStorageKey(accountName) {
  return `${USER_REPLY_SEEN_PREFIX}${accountName}`
}

function readSeenReplyIds(accountName) {
  if (!accountName) {
    return []
  }

  try {
    const raw = window.localStorage.getItem(getSeenReplyStorageKey(accountName))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeSeenReplyIds(accountName, ids) {
  if (!accountName) {
    return
  }

  window.localStorage.setItem(getSeenReplyStorageKey(accountName), JSON.stringify(ids))
}

function refreshUnreadReplies() {
  if (!currentUser.value) {
    unreadReplyIds.value = []
    return
  }

  const seenIds = new Set(readSeenReplyIds(currentUser.value))
  unreadReplyIds.value = replyLetters.value
    .filter((item) => !seenIds.has(item.id))
    .map((item) => item.id)
}

function markRepliesAsRead(ids) {
  if (!currentUser.value || !ids.length) {
    return
  }

  const mergedIds = [...new Set([...readSeenReplyIds(currentUser.value), ...ids])]
  writeSeenReplyIds(currentUser.value, mergedIds)
  refreshUnreadReplies()
}

function showNotice(message, tone = 'info') {
  noticeMessage.value = message
  noticeTone.value = tone

  window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => {
    noticeMessage.value = ''
  }, 3200)
}

function persistUserSession(accountName) {
  currentUser.value = accountName
  window.localStorage.setItem(USER_STORAGE_KEY, accountName)
}

function clearUserSession() {
  currentUser.value = ''
  window.localStorage.removeItem(USER_STORAGE_KEY)
  unreadReplyIds.value = []
}

function logoutUser() {
  clearUserSession()
  showLogin.value = false
  authMode.value = 'login'
  authError.value = ''
  authSuccess.value = ''
  loginAccount.value = ''
  loginPassword.value = ''
  worry.value = ''
  hasSubmitted.value = false
  submitError.value = ''
  letterHistory.value = []
  historyError.value = ''
  currentPage.value = 'home'
  window.clearInterval(userPollingTimer)
}

function backToHome() {
  appView.value = 'public'
  currentPage.value = 'home'
}

function handleTopbarAction() {
  if (currentUser.value) {
    logoutUser()
    return
  }

  if (adminSession.value) {
    appView.value = 'admin'
    return
  }

  openLogin()
}

async function loadAdminLetters() {
  if (!adminSession.value) {
    adminLetters.value = []
    adminError.value = ''
    return
  }

  const token = window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || ''

  if (!token) {
    adminLetters.value = []
    adminError.value = '管理者登入資訊已遺失，請重新登入。'
    return
  }

  isAdminLoading.value = true
  adminError.value = ''

  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/letters`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || '讀取來信失敗。')
    }

    const nextLetters = Array.isArray(data.letters) ? data.letters : []

    if (adminKnownLetterIds.value.length) {
      const freshLetters = nextLetters.filter((letter) => !adminKnownLetterIds.value.includes(letter.id))

      if (freshLetters.length) {
        showNotice(`店主信箱收到 ${freshLetters.length} 封新來信。`, 'keeper')
      }
    }

    adminKnownLetterIds.value = nextLetters.map((letter) => letter.id)
    adminLetters.value = nextLetters
  } catch (error) {
    adminError.value = error instanceof Error ? error.message : '讀取來信失敗。'
  } finally {
    isAdminLoading.value = false
  }
}

function openReplyForm(letter) {
  activeReplyId.value = letter.id
  replyDraft.value = letter.reply || ''
  adminSuccess.value = ''
  adminError.value = ''
}

function closeReplyForm() {
  activeReplyId.value = ''
  replyDraft.value = ''
}

async function submitReply(letterId) {
  if (!replyDraft.value.trim()) {
    adminError.value = '請先寫下回信內容。'
    return
  }

  const token = window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || ''

  if (!token) {
    adminError.value = '管理者登入資訊已遺失，請重新登入。'
    return
  }

  isReplySubmitting.value = true
  adminError.value = ''
  adminSuccess.value = ''

  try {
    const response = await fetch(`${API_BASE_URL}/api/admin/letters/${letterId}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        reply: replyDraft.value.trim(),
      }),
    })
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || '回信送出失敗。')
    }

    adminSuccess.value = '此信件已回覆。'
    closeReplyForm()
    await loadAdminLetters()
  } catch (error) {
    adminError.value = error instanceof Error ? error.message : '回信送出失敗。'
  } finally {
    isReplySubmitting.value = false
  }
}

function openDoor() {
  if (!currentUser.value) {
    authMode.value = 'login'
    authError.value = adminSession.value
      ? '管理者身份不會進入寫信頁，請先登入一般帳號。'
      : '請先登入，再推開這扇門。'
    authSuccess.value = ''
    showLogin.value = true
    return
  }

  currentPage.value = 'opening'

  window.setTimeout(() => {
    currentPage.value = 'hall'
  }, 2200)
}

function goToLetter() {
  currentPage.value = 'letter'
  loadLetterHistory()
}

async function loadLetterHistory() {
  if (!currentUser.value) {
    letterHistory.value = []
    historyError.value = ''
    return
  }

  isHistoryLoading.value = true
  historyError.value = ''

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/letters/history?accountName=${encodeURIComponent(currentUser.value)}`
    )
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || '讀取歷史紀錄失敗。')
    }

    const previousUnreadCount = unreadReplyIds.value.length
    letterHistory.value = Array.isArray(data.letters) ? data.letters : []
    refreshUnreadReplies()

    if (currentPage.value === 'letter' && unreadReplyIds.value.length > previousUnreadCount) {
      showNotice(`店主剛剛回了你 ${unreadReplyIds.value.length - previousUnreadCount} 封信。`, 'reply')
    }
  } catch (error) {
    historyError.value = error instanceof Error ? error.message : '讀取歷史紀錄失敗。'
  } finally {
    isHistoryLoading.value = false
  }
}

async function sendLetter() {
  if (!worry.value.trim()) {
    window.alert('先寫下一點煩惱吧。')
    return
  }

  isSubmitting.value = true
  submitError.value = ''
  hasSubmitted.value = false

  try {
    const response = await fetch(`${API_BASE_URL}/api/letters`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        accountName: currentUser.value || null,
        content: worry.value.trim(),
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || '寄信失敗，請稍後再試一次。')
    }

    hasSubmitted.value = true
    worry.value = ''
    await loadLetterHistory()
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : '寄信失敗，請稍後再試一次。'
  } finally {
    isSubmitting.value = false
  }
}

function closeLogin() {
  showLogin.value = false
  authError.value = ''
  authSuccess.value = ''
}

function openLogin() {
  showLogin.value = true
  authMode.value = 'login'
  authError.value = ''
  authSuccess.value = ''
}

function switchAuthMode(mode) {
  authMode.value = mode
  authError.value = ''
  authSuccess.value = ''
  loginPassword.value = ''
}

async function restoreSavedSession() {
  const savedUser = window.localStorage.getItem(USER_STORAGE_KEY) || ''
  const savedAdminAccount = window.localStorage.getItem(ADMIN_ACCOUNT_STORAGE_KEY) || ''
  const savedAdminToken = window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || ''

  if (savedAdminAccount && savedAdminToken) {
    adminSession.value = savedAdminAccount
    clearUserSession()
    appView.value = 'admin'
    await loadAdminLetters()
    startAdminPolling()
    return
  }

  if (savedUser) {
    persistUserSession(savedUser)
    await loadLetterHistory()
    startUserPolling()
  }
}

function startUserPolling() {
  window.clearInterval(userPollingTimer)

  if (currentUser.value) {
    userPollingTimer = window.setInterval(() => {
      loadLetterHistory()
    }, 20000)
  }
}

function startAdminPolling() {
  window.clearInterval(adminPollingTimer)

  if (adminSession.value) {
    adminPollingTimer = window.setInterval(() => {
      loadAdminLetters()
    }, 20000)
  }
}

async function submitLogin() {
  authError.value = ''
  authSuccess.value = ''

  if (!loginAccount.value.trim()) {
    authError.value = '請先輸入帳號。'
    return
  }

  if (authMode.value === 'login' && !loginPassword.value) {
    authError.value = '請先輸入帳號和密碼。'
    return
  }

  isAuthSubmitting.value = true

  try {
    const payload = {
      account: loginAccount.value.trim(),
      password: loginPassword.value,
    }

    if (authMode.value === 'register') {
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || '註冊失敗，請再試一次。')
      }

      persistUserSession(data.accountName || loginAccount.value.trim())
      authSuccess.value = `註冊成功，歡迎你 ${currentUser.value}。`
      adminSession.value = ''
      window.clearInterval(adminPollingTimer)
      await loadLetterHistory()
      startUserPolling()
    } else {
      const userResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const userData = await userResponse.json()

      if (userResponse.ok) {
        persistUserSession(userData.accountName || loginAccount.value.trim())
        adminSession.value = ''
        window.localStorage.removeItem(ADMIN_ACCOUNT_STORAGE_KEY)
        window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
        window.clearInterval(adminPollingTimer)
        authSuccess.value = `已登入 ${currentUser.value}。`
        await loadLetterHistory()
        startUserPolling()
      } else {
        const adminResponse = await fetch(`${API_BASE_URL}/api/admin/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })

        const adminData = await adminResponse.json()

        if (!adminResponse.ok) {
          throw new Error(userData.message || '登入失敗，請再試一次。')
        }

        clearUserSession()
        window.clearInterval(userPollingTimer)
        adminSession.value = adminData.accountName || loginAccount.value.trim()
        window.localStorage.setItem(ADMIN_ACCOUNT_STORAGE_KEY, adminSession.value)
        window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, adminData.token || '')
        authSuccess.value = `已辨識為管理者 ${adminSession.value}，即將進入管理頁。`
        await loadAdminLetters()
        startAdminPolling()

        window.setTimeout(() => {
          showLogin.value = false
          authMode.value = 'login'
          authError.value = ''
          authSuccess.value = ''
          loginPassword.value = ''
          appView.value = 'admin'
        }, 900)

        return
      }
    }

    window.setTimeout(() => {
      showLogin.value = false
      authMode.value = 'login'
      authError.value = ''
      authSuccess.value = ''
      loginPassword.value = ''
    }, 900)
  } catch (error) {
    if (authMode.value === 'login') {
      authError.value = '帳號密碼錯誤'
    } else {
      authError.value = error instanceof Error ? error.message : '操作失敗，請稍後再試。'
    }
  } finally {
    isAuthSubmitting.value = false
  }
}

function logoutAdmin() {
  appView.value = 'public'
  adminSession.value = ''
  adminLetters.value = []
  adminKnownLetterIds.value = []
  adminError.value = ''
  adminSuccess.value = ''
  activeReplyId.value = ''
  replyDraft.value = ''
  window.localStorage.removeItem(ADMIN_ACCOUNT_STORAGE_KEY)
  window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
  window.clearInterval(adminPollingTimer)
}

function openExpandedLetter(type, item) {
  if (type === 'reply') {
    markRepliesAsRead([item.id])
  }

  expandedLetter.value = {
    type,
    item,
  }
}

function closeExpandedLetter() {
  expandedLetter.value = null
}

onMounted(() => {
  restoreSavedSession()
})

onUnmounted(() => {
  window.clearInterval(userPollingTimer)
  window.clearInterval(adminPollingTimer)
  window.clearTimeout(noticeTimer)
})
</script>

<template>
  <main class="page-shell">
    <transition name="login-fade">
      <div v-if="noticeMessage" class="app-notice" :class="`app-notice-${noticeTone}`">
        {{ noticeMessage }}
      </div>
    </transition>

    <transition name="login-fade">
      <div v-if="expandedLetter" class="login-backdrop" @click="closeExpandedLetter">
        <section class="detail-modal" @click.stop>
          <button type="button" class="login-close" aria-label="關閉內容視窗" @click="closeExpandedLetter">
            ×
          </button>
          <p class="login-kicker">
            {{
              expandedLetter.type === 'reply'
                ? 'Keeper Reply'
                : expandedLetter.type === 'admin'
                  ? 'Admin Letter'
                  : 'Letter History'
            }}
          </p>
          <h3>
            {{
              expandedLetter.type === 'reply'
                ? '店主回信'
                : expandedLetter.type === 'admin'
                  ? '來信全文'
                  : '歷史紀錄'
            }}
          </h3>
          <p class="detail-meta">
            {{
              expandedLetter.type === 'reply'
                ? `回覆時間：${new Date(expandedLetter.item.repliedAt || expandedLetter.item.createdAt).toLocaleString()}`
                : expandedLetter.type === 'admin'
                  ? `寄信時間：${new Date(expandedLetter.item.createdAt).toLocaleString()}`
                : `寄信時間：${new Date(expandedLetter.item.createdAt).toLocaleString()}`
            }}
          </p>
          <div v-if="expandedLetter.type === 'history' || expandedLetter.type === 'admin'" class="detail-status-row">
            <span class="history-status" :class="`history-status-${expandedLetter.item.status}`">
              {{ expandedLetter.item.status === 'replied' ? '已回覆' : expandedLetter.type === 'admin' ? '待回覆' : '已收到' }}
            </span>
          </div>
          <p v-if="expandedLetter.type === 'admin'" class="detail-meta">
            帳號名：{{ expandedLetter.item.accountName || '未登入旅人' }}
          </p>
          <p class="detail-content">
            {{
              expandedLetter.type === 'reply'
                ? expandedLetter.item.reply
                : expandedLetter.item.content
            }}
          </p>
          <div v-if="expandedLetter.type === 'admin' && expandedLetter.item.reply" class="detail-admin-reply">
            <p class="admin-letter-label">目前回信</p>
            <p class="detail-content">{{ expandedLetter.item.reply }}</p>
          </div>
        </section>
      </div>
    </transition>

    <section v-if="appView === 'admin'" class="scene admin-scene">
      <div class="admin-shell">
        <button type="button" class="admin-back" @click="backToHome">回到首頁</button>

        <div class="admin-panel">
          <p class="admin-kicker">Admin Entrance</p>
          <h1>星川雜貨店管理頁</h1>
          <p class="admin-copy">只有你的管理者帳密會進到這裡。接下來我們可以把查看來信、整理回覆與管理深夜信箱都接進來。</p>

          <template v-if="adminSession">
            <div class="admin-welcome">
              <p class="admin-welcome-kicker">Keeper Logged In</p>
              <h2>{{ adminSession }}</h2>
            </div>

            <p v-if="adminError" class="auth-error">{{ adminError }}</p>
            <p v-if="adminSuccess" class="auth-success">{{ adminSuccess }}</p>

            <div class="admin-toolbar">
              <label class="admin-toolbar-field">
                <span>搜尋帳號</span>
                <input
                  v-model="adminSearch"
                  class="login-input admin-toolbar-input"
                  type="text"
                  placeholder="輸入帳號名稱"
                />
              </label>

              <label class="admin-toolbar-field">
                <span>回覆狀態</span>
                <select v-model="adminStatusFilter" class="login-input admin-toolbar-select">
                  <option value="all">全部信件</option>
                  <option value="pending">未回覆</option>
                  <option value="replied">已回覆</option>
                </select>
              </label>

              <label class="admin-toolbar-field">
                <span>時間排序</span>
                <select v-model="adminSortOrder" class="login-input admin-toolbar-select">
                  <option value="newest">最新優先</option>
                  <option value="oldest">最舊優先</option>
                </select>
              </label>
            </div>

            <section class="admin-letter-list">
              <article v-if="isAdminLoading" class="admin-letter-card">
                <p class="admin-letter-empty">正在整理來信中…</p>
              </article>

              <article v-else-if="!adminLetters.length" class="admin-letter-card">
                <p class="admin-letter-empty">目前還沒有來信。</p>
              </article>

              <article v-else-if="!filteredAdminLetters.length" class="admin-letter-card">
                <p class="admin-letter-empty">目前沒有符合這組條件的信件。</p>
              </article>

              <article
                v-for="letter in filteredAdminLetters"
                :key="letter.id"
                class="admin-letter-card"
              >
                <div class="admin-letter-head">
                  <div>
                    <p class="admin-letter-label">帳號名</p>
                    <h3>{{ letter.accountName || '未登入旅人' }}</h3>
                    <p class="admin-letter-time">寄信時間：{{ new Date(letter.createdAt).toLocaleString() }}</p>
                  </div>
                  <span class="history-status" :class="`history-status-${letter.status}`">
                    {{ letter.status === 'replied' ? '已回覆' : '待回覆' }}
                  </span>
                </div>

                <div class="admin-letter-block">
                  <p class="admin-letter-label">信件內容</p>
                  <p class="admin-letter-content admin-letter-preview">{{ letter.content }}</p>
                </div>

                <div v-if="letter.reply" class="admin-letter-block">
                  <p class="admin-letter-label">目前回信</p>
                  <p class="admin-letter-content admin-letter-preview">{{ letter.reply }}</p>
                </div>

                <div class="admin-letter-actions">
                  <button
                    type="button"
                    class="ghost-button admin-view-button"
                    @click="openExpandedLetter('admin', letter)"
                  >
                    查看完整內容
                  </button>
                  <button
                    type="button"
                    class="ready-button admin-reply-button"
                    @click="openReplyForm(letter)"
                  >
                    {{ letter.reply ? '修改回信' : '回信' }}
                  </button>
                </div>

                <div v-if="activeReplyId === letter.id" class="admin-reply-panel">
                  <label class="login-label" :for="`reply-${letter.id}`">店主回信</label>
                  <textarea
                    :id="`reply-${letter.id}`"
                    v-model="replyDraft"
                    class="admin-reply-textarea"
                    :disabled="isReplySubmitting"
                    placeholder="把想回覆的內容寫在這裡……"
                  />
                  <div class="admin-reply-actions">
                    <button
                      type="button"
                      class="ready-button admin-send-button"
                      :disabled="isReplySubmitting"
                      @click="submitReply(letter.id)"
                    >
                      {{ isReplySubmitting ? '寄送中...' : '送出回信' }}
                    </button>
                    <button
                      type="button"
                      class="ghost-button admin-cancel-button"
                      :disabled="isReplySubmitting"
                      @click="closeReplyForm"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </article>
            </section>

            <div class="admin-actions">
              <button type="button" class="ready-button" @click="backToHome">先回首頁</button>
              <button type="button" class="ghost-button" @click="logoutAdmin">登出</button>
            </div>
          </template>
          <template v-else>
            <div class="admin-welcome">
              <p class="admin-welcome-kicker">No Active Session</p>
              <h2>尚未登入</h2>
              <p>請從首頁右上角的登入入口輸入你的管理者帳密，系統會自動帶你進來。</p>
            </div>
          </template>
        </div>
      </div>
    </section>

    <template v-else>
    <transition name="login-fade">
      <div v-if="showLogin" class="login-backdrop" @click="closeLogin">
        <form class="login-modal" @click.stop @submit.prevent="submitLogin">
          <button type="button" class="login-close" aria-label="關閉登入視窗" @click="closeLogin">
            ×
          </button>
          <p class="login-kicker">Store Keeper</p>
          <h3>
            {{
              authMode === 'login'
                ? '登入'
                : '註冊帳號'
            }}
          </h3>
          <div class="login-copy-block">
            <p class="login-copy">
              {{ authMode === 'login'
                ? '登入後可以保留你的帳號以及寫信的所有紀錄'
                : '第一次來這裡的人，可以先註冊帳號，再把心事寫下來。'
              }}
            </p>
            <p
              class="auth-hint register-hint"
              :class="{ 'register-hint-placeholder': authMode !== 'register' }"
            >
              本平台重視匿名與隱私，若忘記密碼，帳號將無法找回。
            </p>
          </div>

          <div class="login-fields">
            <div class="login-field">
              <label class="login-label" for="loginAccount">帳號</label>
              <input
                id="loginAccount"
                v-model="loginAccount"
                class="login-input"
                type="text"
                :disabled="isAuthSubmitting"
                placeholder="輸入帳號"
              />
            </div>

            <div class="login-field">
              <label class="login-label" for="loginPassword">密碼</label>
              <input
                id="loginPassword"
                v-model="loginPassword"
                class="login-input"
                type="password"
                :disabled="isAuthSubmitting"
                placeholder="輸入密碼"
              />
            </div>
          </div>

          <p v-if="authError" class="auth-error">{{ authError }}</p>
          <p v-if="authSuccess" class="auth-success">{{ authSuccess }}</p>

          <button type="submit" class="login-submit" :disabled="isAuthSubmitting">
            {{
              isAuthSubmitting
                ? authMode === 'login'
                  ? '登入中...'
                  : '註冊中...'
                : authMode === 'login'
                  ? '登入'
                  : '建立帳號'
            }}
          </button>

          <button
            v-if="authMode === 'login'"
            type="button"
            class="register-link"
            :disabled="isAuthSubmitting"
            @click="switchAuthMode('register')"
          >
            註冊帳號
          </button>
          <button
            v-if="authMode !== 'login'"
            type="button"
            class="register-link"
            :disabled="isAuthSubmitting"
            @click="switchAuthMode('login')"
          >
            已經有帳號了，回去登入
          </button>
        </form>
      </div>
    </transition>

    <transition name="scene" mode="out-in">
      <section v-if="currentPage === 'home'" key="home" class="scene alley-scene">
        <div class="alley-frame" :style="{ '--alley-image': `url(${alleyScene})` }">
          <div class="door-echo" aria-hidden="true"></div>
          <div class="alley-overlay" aria-hidden="true"></div>
          <div class="alley-vignette" aria-hidden="true"></div>

          <div class="scene-topbar">
            <button
              type="button"
              class="login-trigger"
              @click="handleTopbarAction()"
            >
              {{ topbarLabel }}
            </button>
          </div>

          <div class="scene-copy">
            <h2>如果你有煩惱或是不開心，請推開這扇門。</h2>
            <p v-if="currentUser" class="scene-user">
              今晚歡迎你，{{ currentUser }}。
              <span v-if="unreadReplyCount" class="reply-badge scene-reply-badge">{{ unreadReplyCount }} 封新回信</span>
            </p>
          </div>

          <button
            type="button"
            class="door-hotspot"
            aria-label="推開雜貨店的門"
            @click="openDoor"
          ></button>
        </div>
      </section>

      <section v-else-if="currentPage === 'opening'" key="opening" class="scene opening-scene">
        <div class="opening-darkness">
          <div class="opening-light-core"></div>
        </div>
      </section>

      <section v-else-if="currentPage === 'hall'" key="hall" class="scene note-scene">
        <div class="note-wall">
          <div class="sticky-note">
            <span class="tape tape-left" aria-hidden="true"></span>
            <span class="tape tape-right" aria-hidden="true"></span>
            <p class="note-kicker">Welcome Note</p>
            <h2>歡迎來到星川雜貨店</h2>
            <p>
              這裡收下每個人的煩惱，
              <br />
              但在寫信之前，請先把心靜下來。
            </p>
            <button type="button" class="ready-button" @click="goToLetter">我準備好了</button>
          </div>
        </div>
      </section>

      <section v-else key="letter" class="scene letter-scene">
        <div class="letter-room">
          <div v-if="currentUser" class="scene-topbar">
            <button type="button" class="login-trigger" @click="logoutUser()">
              登出
            </button>
          </div>

          <div class="letter-room-copy">
            <p class="scene-title">Letter Room</p>
            <h2>把心事慢慢寫下來</h2>
            <p>
              想說的、說不出口的、還沒有答案的，都可以先寫在這裡。
            </p>
          </div>

          <transition name="paper" appear>
            <div class="letter-paper">
              <div class="letter-paper-head">
                <span>深夜信箱</span>
                <span>店主親啟</span>
              </div>

              <label class="sr-only" for="worry">你的煩惱</label>
              <textarea
                id="worry"
                v-model="worry"
                :disabled="isSubmitting"
                placeholder="您好，我最近……"
              />

              <button type="button" class="submit-button" :disabled="isSubmitting" @click="sendLetter">
                {{ isSubmitting ? '寄送中...' : '投入信箱' }}
              </button>

              <transition name="reply-fade">
                <p v-if="submitError" class="submit-error">{{ submitError }}</p>
              </transition>

              <transition name="reply-fade">
                <section v-if="hasSubmitted" class="reply-card">
                  <h3>店主已收到信件</h3>
                  <p>謝謝你願意把這件事寫下來，晚點就會收到回信了。</p>
                </section>
              </transition>
            </div>
          </transition>

          <section class="letter-board-grid">
            <article class="letter-board">
              <div class="letter-board-head">
                <h3>店主回信</h3>
                <span v-if="currentUser" class="letter-board-status">
                  <span v-if="unreadReplyCount" class="reply-badge">{{ unreadReplyCount }} 封未讀</span>
                  <span v-else>回覆收件匣</span>
                </span>
                <span v-else>登入後可查看</span>
              </div>

              <p v-if="!currentUser" class="letter-board-empty">登入後，這裡會顯示店主已回覆給你的內容。</p>
              <p v-else-if="isHistoryLoading" class="letter-board-empty">正在整理回信中…</p>
              <p v-else-if="historyError" class="letter-board-empty">{{ historyError }}</p>
              <article
                v-if="currentUser && latestReply"
                class="latest-reply-banner"
                role="button"
                tabindex="0"
                @click="openExpandedLetter('reply', latestReply)"
                @keydown.enter.prevent="openExpandedLetter('reply', latestReply)"
              >
                <div class="latest-reply-head">
                  <strong>最新回信</strong>
                  <span v-if="unreadReplyIds.includes(latestReply.id)" class="reply-badge">新回信</span>
                </div>
                <p class="history-meta">回覆時間：{{ new Date(latestReply.repliedAt || latestReply.createdAt).toLocaleString() }}</p>
                <p class="history-content">{{ latestReply.reply }}</p>
              </article>
              <div v-if="replyLetters.length > 1" class="letter-board-list">
                <article
                  v-for="item in replyLetters.slice(1)"
                  :key="`reply-${item.id}`"
                  class="history-card reply-history-card"
                  role="button"
                  tabindex="0"
                  @click="openExpandedLetter('reply', item)"
                  @keydown.enter.prevent="openExpandedLetter('reply', item)"
                >
                  <div class="history-row">
                    <p class="history-meta">回覆時間：{{ new Date(item.repliedAt || item.createdAt).toLocaleString() }}</p>
                    <span v-if="unreadReplyIds.includes(item.id)" class="reply-badge">未讀</span>
                  </div>
                  <p class="history-content">{{ item.reply }}</p>
                  <p class="history-more">點擊查看完整內容</p>
                </article>
              </div>
              <p v-if="currentUser && !replyLetters.length" class="letter-board-empty">目前還沒有店主回信，等店主寫好回覆後會出現在這裡。</p>
            </article>

            <article class="letter-board">
              <div class="letter-board-head">
                <h3>歷史紀錄</h3>
                <span>{{ currentUser ? `${letterHistory.length} 封來信` : '登入後可查看' }}</span>
              </div>

              <p v-if="!currentUser" class="letter-board-empty">登入後，這裡會保存你曾經投出的每一封信。</p>
              <p v-else-if="isHistoryLoading" class="letter-board-empty">正在整理歷史紀錄…</p>
              <p v-else-if="historyError" class="letter-board-empty">{{ historyError }}</p>
              <div v-else-if="letterHistory.length" class="letter-board-list">
                <article
                  v-for="item in letterHistory"
                  :key="item.id"
                  class="history-card"
                  role="button"
                  tabindex="0"
                  @click="openExpandedLetter('history', item)"
                  @keydown.enter.prevent="openExpandedLetter('history', item)"
                >
                  <div class="history-row">
                    <p class="history-meta">{{ new Date(item.createdAt).toLocaleString() }}</p>
                    <span class="history-status" :class="`history-status-${item.status}`">
                      {{ item.status === 'replied' ? '已回覆' : '已收到' }}
                    </span>
                  </div>
                  <p class="history-content">{{ item.content }}</p>
                  <p class="history-more">點擊查看完整內容</p>
                </article>
              </div>
              <p v-else class="letter-board-empty">你還沒有歷史來信，先寫下第一封信吧。</p>
            </article>
          </section>
        </div>
      </section>
    </transition>
    </template>
  </main>
</template>

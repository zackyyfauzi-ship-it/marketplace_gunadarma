const conditionNames = {
  needs_repair: "Perlu perbaikan",
  fair: "Layak",
  good: "Bagus",
  like_new: "Seperti baru",
};
const state = { user: null, activeConversation: null, conversations: [], pollTimer: null };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : {};
  if (!response.ok) throw new Error(data.error || "Permintaan gagal. Silakan coba lagi.");
  return data;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("visible"), 3000);
}

function setError(element, message) {
  element.textContent = message;
  element.classList.toggle("hidden", !message);
}

function displayAuth(mode = "login") {
  setAuthMode(mode);
  $("#auth-dialog").showModal();
}

function setAuthMode(mode) {
  const register = mode === "register";
  $$(".auth-switch button").forEach((button) => button.classList.toggle("active", button.dataset.authMode === mode));
  $$(".register-only").forEach((wrapper) => wrapper.classList.toggle("hidden", !register));
  ["fullName", "phone"].forEach((name) => {
    $("#auth-form").elements[name].required = register;
  });
  $("#auth-form").elements.username.required = false;
  $("#auth-form").elements.password.autocomplete = register ? "new-password" : "current-password";
  $("#auth-title").textContent = register ? "Buat akun kampusmu" : "Selamat datang kembali";
  $("#auth-subtitle").textContent = register
    ? "Daftar dengan NPM Gunadarma untuk mulai jual beli."
    : "Masuk untuk mulai terhubung dengan teman kampus.";
  $("#auth-submit").textContent = register ? "Buat akun" : "Masuk";
  $("#auth-form").dataset.mode = mode;
  setError($("#auth-error"), "");
}

function avatarMarkup(url, name) {
  const initial = escapeHtml((name || "?").trim().charAt(0).toUpperCase());
  return url
    ? `<span class="seller-dot"><img src="${escapeHtml(url)}" alt=""></span>`
    : `<span class="seller-dot">${initial}</span>`;
}

function formatPrice(value) {
  return `Rp${Number(value).toLocaleString("id-ID")}`;
}

function cardMarkup(item, own = false) {
  const sold = item.status === "sold";
  const image = item.image_url
    ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.title)}" loading="lazy">`
    : `<span class="photo-placeholder" aria-hidden="true">✳</span>`;
  return `<article class="listing-card" data-listing-id="${escapeHtml(item.id)}" tabindex="0">
    <div class="listing-photo">${image}${sold ? '<span class="status-badge sold">TERJUAL</span>' : ""}</div>
    <div class="listing-info">
      <div class="listing-category">${escapeHtml(item.category)}</div>
      <div class="listing-title">${escapeHtml(item.title)}</div>
      <div class="listing-price">${formatPrice(item.price)}</div>
      <div class="listing-meta">
        <span class="seller-chip">${avatarMarkup(item.seller_avatar, item.seller_name)}${escapeHtml(item.seller_name)}</span>
        ${own && !sold ? `<button class="status-action" data-status-id="${escapeHtml(item.id)}" aria-label="Tandai terjual">Terjual</button>` : ""}
        ${own && sold ? `<button class="status-action" data-reactivate-id="${escapeHtml(item.id)}" aria-label="Aktifkan kembali">Aktifkan</button>` : `<span>${sold ? "Terjual" : escapeHtml(conditionNames[item.item_condition] || "")}</span>`}
      </div>
    </div>
  </article>`;
}

function renderListings(items, own = false) {
  const grid = $(own ? "#my-listing-grid" : "#listing-grid");
  const empty = $(own ? "#my-listing-empty" : "#market-empty");
  grid.innerHTML = items.map((item) => cardMarkup(item, own)).join("");
  empty.classList.toggle("hidden", items.length > 0);
  grid.classList.toggle("hidden", items.length === 0);
  grid.querySelectorAll(".listing-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("[data-status-id], [data-reactivate-id]")) return;
      showListing(card.dataset.listingId);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showListing(card.dataset.listingId);
      }
    });
  });
  grid.querySelectorAll("[data-status-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      changeListingStatus(button.dataset.statusId, "sold");
    });
  });
  grid.querySelectorAll("[data-reactivate-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      changeListingStatus(button.dataset.reactivateId, "active");
    });
  });
}

async function loadListings(own = false) {
  const params = new URLSearchParams();
  if (own) params.set("mine", "true");
  else {
    const query = $("#search-input").value.trim();
    const category = $("#category-filter").value;
    if (query) params.set("q", query);
    if (category) params.set("category", category);
  }
  const data = await api(`/api/listings?${params}`);
  renderListings(data.listings, own);
}

async function loadCategories() {
  const { categories } = await api("/api/categories");
  categories.forEach((category) => {
    $("#category-filter").insertAdjacentHTML("beforeend", `<option value="${category.id}">${escapeHtml(category.name)}</option>`);
    $("#listing-form").elements.categoryId.insertAdjacentHTML("beforeend", `<option value="${category.id}">${escapeHtml(category.name)}</option>`);
  });
}

function updateUserUI() {
  $$(".signed-in-only").forEach((element) => element.classList.toggle("hidden", !state.user));
  $("#login-button").classList.toggle("hidden", !!state.user);
  $("#account-button").classList.toggle("hidden", !state.user);
  $("#messages-nav").classList.toggle("hidden", !state.user);
  if (state.user) {
    $("#account-button").innerHTML = state.user.avatarUrl
      ? `<img src="${escapeHtml(state.user.avatarUrl)}" alt="">`
      : escapeHtml((state.user.displayName || "?").charAt(0).toUpperCase());
    $("#account-button").title = state.user.displayName;
    $("#profile-form").elements.fullName.value = state.user.name;
    $("#profile-form").elements.username.value = state.user.username || "";
    $("#profile-form").elements.npm.value = state.user.npm;
    $("#profile-form").elements.phone.value = state.user.phone;
    $("#profile-photo").innerHTML = state.user.avatarUrl
      ? `<img src="${escapeHtml(state.user.avatarUrl)}" alt="Foto profil">`
      : escapeHtml((state.user.displayName || "?").charAt(0).toUpperCase());
  }
}

async function refreshUser() {
  const { user } = await api("/api/me");
  state.user = user;
  updateUserUI();
  if (user) await refreshConversations();
}

function switchView(name) {
  if (["my-listings", "chats", "profile"].includes(name) && !state.user) {
    displayAuth();
    return;
  }
  $$(".view-panel").forEach((panel) => panel.classList.toggle("hidden", panel.id !== `${name}-view`));
  $$(".nav-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === name));
  $("#welcome-banner").classList.toggle("hidden", name !== "market");
  if (name === "my-listings") loadListings(true).catch(showError);
  if (name === "market") loadListings().catch(showError);
  if (name === "chats") refreshConversations().catch(showError);
}

function showError(error) {
  toast(error.message || "Terjadi kesalahan. Silakan coba lagi.");
}

function showListing(id) {
  api(`/api/listings/${encodeURIComponent(id)}`).then(({ listing }) => {
    const isOwn = state.user && String(state.user.id) === String(listing.seller_id);
    const sold = listing.status === "sold";
    const gallery = listing.images?.[0]
      ? `<img src="${escapeHtml(listing.images[0])}" alt="${escapeHtml(listing.title)}">`
      : "✳";
    const sellerAvatar = listing.seller_avatar
      ? `<span class="seller-dot"><img src="${escapeHtml(listing.seller_avatar)}" alt=""></span>`
      : `<span class="seller-dot">${escapeHtml(listing.seller_name.charAt(0).toUpperCase())}</span>`;
    $("#detail-content").innerHTML = `<div class="detail-layout">
      <div class="detail-gallery">${gallery}</div>
      <div class="detail-copy">
        <span class="eyebrow">${escapeHtml(listing.category)}${sold ? " · TERJUAL" : ""}</span>
        <h2>${escapeHtml(listing.title)}</h2>
        <div class="detail-price">${formatPrice(listing.price)}</div>
        <p class="detail-description">${escapeHtml(listing.description)}</p>
        <div class="detail-facts"><span>Kondisi: <strong>${escapeHtml(conditionNames[listing.item_condition])}</strong></span><span>Meetup: <strong>${escapeHtml(listing.meetup_location || "Atur lewat chat")}</strong></span></div>
        <div class="detail-seller">${sellerAvatar}<span>${escapeHtml(listing.seller_name)}<small class="field-hint"> · Mahasiswa Gunadarma</small></span></div>
        ${isOwn ? `<button class="button button-outline" disabled>Ini barang yang kamu pasang</button>` : sold ? `<button class="button button-outline" disabled>Barang sudah terjual</button>` : `<button class="button button-primary" id="chat-seller">✉ Chat penjual</button>`}
      </div></div>`;
    $("#detail-dialog").showModal();
    const chatButton = $("#chat-seller");
    if (chatButton) chatButton.addEventListener("click", () => startConversation(listing.id));
  }).catch(showError);
}

async function startConversation(listingId) {
  if (!state.user) {
    $("#detail-dialog").close();
    displayAuth();
    return;
  }
  try {
    const { conversationId } = await api("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId }),
    });
    $("#detail-dialog").close();
    await refreshConversations();
    switchView("chats");
    await openConversation(conversationId);
  } catch (error) {
    showError(error);
  }
}

async function changeListingStatus(id, status) {
  try {
    await api(`/api/listings/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    toast(status === "sold" ? "Barang ditandai terjual." : "Barang aktif kembali.");
    await loadListings(true);
    await loadListings();
  } catch (error) {
    showError(error);
  }
}

async function refreshConversations() {
  if (!state.user) return;
  const { conversations } = await api("/api/conversations");
  state.conversations = conversations;
  const list = $("#conversation-list");
  list.innerHTML = conversations.length ? conversations.map((conversation) => `
    <button class="conversation-entry ${String(state.activeConversation) === String(conversation.id) ? "active" : ""}" data-conversation-id="${escapeHtml(conversation.id)}">
      <strong>${escapeHtml(conversation.other_name)}</strong>
      <span>${escapeHtml(conversation.listing_title)}</span>
      <small>${escapeHtml(conversation.last_message || "Mulai percakapan")}</small>
    </button>`).join("") : `<div class="chat-placeholder"><p>Belum ada percakapan.<br>Mulai chat dari halaman barang.</p></div>`;
  list.querySelectorAll("[data-conversation-id]").forEach((button) => {
    button.addEventListener("click", () => openConversation(button.dataset.conversationId));
  });
  $("#chat-count").textContent = conversations.length;
  $("#chat-count").classList.toggle("hidden", !conversations.length);
  $("#message-dot").classList.toggle("hidden", !conversations.length);
  if (state.activeConversation && $("#chats-view").classList.contains("hidden") === false) {
    const exists = conversations.some((item) => String(item.id) === String(state.activeConversation));
    if (!exists) state.activeConversation = null;
  }
}

async function openConversation(id) {
  state.activeConversation = id;
  await refreshConversations();
  const conversation = state.conversations.find((item) => String(item.id) === String(id));
  if (!conversation) return;
  const windowElement = $("#chat-window");
  windowElement.innerHTML = `<div class="chat-heading"><span class="seller-dot">✉</span><div><strong>${escapeHtml(conversation.other_name)}</strong><small>${escapeHtml(conversation.listing_title)}${conversation.listing_status === "sold" ? " · Terjual" : ""}</small></div></div>
    <div class="message-list" id="message-list"></div>
    <form class="message-form" id="message-form"><input name="body" maxlength="2000" placeholder="Tulis pesan..." autocomplete="off" required><button class="button button-primary" type="submit" aria-label="Kirim pesan">Kirim</button></form>`;
  $("#message-form").addEventListener("submit", sendMessage);
  await loadMessages(id);
}

async function loadMessages(id) {
  const { messages } = await api(`/api/conversations/${encodeURIComponent(id)}/messages`);
  if (String(state.activeConversation) !== String(id)) return;
  const list = $("#message-list");
  const previousHeight = list.scrollHeight;
  list.innerHTML = messages.map((message) => {
    const mine = String(message.sender_id) === String(state.user.id);
    const time = new Date(message.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    return `<div class="message-bubble ${mine ? "mine" : ""}">${escapeHtml(message.body)}<time>${time}</time></div>`;
  }).join("");
  if (list.scrollHeight !== previousHeight || list.scrollTop + list.clientHeight >= previousHeight - 30) {
    list.scrollTop = list.scrollHeight;
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const input = event.currentTarget.elements.body;
  const body = input.value.trim();
  if (!body || !state.activeConversation) return;
  input.disabled = true;
  try {
    await api(`/api/conversations/${encodeURIComponent(state.activeConversation)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    input.value = "";
    await Promise.all([loadMessages(state.activeConversation), refreshConversations()]);
  } catch (error) {
    showError(error);
  } finally {
    input.disabled = false;
    input.focus();
  }
}

$$(".nav-tab").forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
$("#search-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadListings().catch(showError);
});
$("#category-filter").addEventListener("change", () => loadListings().catch(showError));
["#sell-button", "#welcome-sell", "#empty-sell", "#my-sell"].forEach((selector) => {
  $(selector).addEventListener("click", () => {
    if (!state.user) displayAuth("register");
    else $("#listing-dialog").showModal();
  });
});
$("#login-button").addEventListener("click", () => displayAuth());
$("#account-button").addEventListener("click", () => switchView("profile"));
$("#messages-nav").addEventListener("click", () => switchView("chats"));
$("#logout-button").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
    state.user = null;
    state.activeConversation = null;
    updateUserUI();
    switchView("market");
    toast("Kamu sudah keluar.");
  } catch (error) {
    showError(error);
  }
});

$$("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
$$("[data-close]").forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.close}`).close()));
$$("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
}));

$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const mode = form.dataset.mode;
  const payload = Object.fromEntries(new FormData(form));
  setError($("#auth-error"), "");
  $("#auth-submit").disabled = true;
  try {
    const { user } = await api(`/api/${mode === "register" ? "register" : "login"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.user = user;
    updateUserUI();
    $("#auth-dialog").close();
    await refreshConversations();
    toast(mode === "register" ? "Akun berhasil dibuat. Selamat datang!" : "Berhasil masuk. Selamat datang kembali!");
  } catch (error) {
    setError($("#auth-error"), error.message);
  } finally {
    $("#auth-submit").disabled = false;
  }
});

$("#listing-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setError($("#listing-error"), "");
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await api("/api/listings", { method: "POST", body: new FormData(form) });
    form.reset();
    $("#listing-dialog").close();
    await loadListings();
    toast("Barang berhasil dipasang di marketplace!");
  } catch (error) {
    setError($("#listing-error"), error.message);
  } finally {
    submit.disabled = false;
  }
});

$("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const { user } = await api("/api/profile", { method: "PUT", body: new FormData(event.currentTarget) });
    state.user = user;
    updateUserUI();
    toast("Profil berhasil disimpan.");
  } catch (error) {
    showError(error);
  }
});

$("#profile-avatar").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    event.target.value = "";
    toast("Ukuran foto maksimal 5 MB.");
    return;
  }
  $("#profile-photo").innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Pratinjau foto profil">`;
});

async function initialize() {
  try {
    await loadCategories();
    await refreshUser();
    await loadListings();
    state.pollTimer = setInterval(() => {
      if (!state.user) return;
      refreshConversations().catch(showError);
      if (state.activeConversation && !$("#chats-view").classList.contains("hidden")) {
        loadMessages(state.activeConversation).catch(showError);
      }
    }, 4000);
  } catch (error) {
    toast(error.message);
  }
}

initialize();

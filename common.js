document.addEventListener("DOMContentLoaded", async () => {
	const themeToggleBtn = document.getElementById("theme-toggle");
	const body = document.body;
	const themeIcon = themeToggleBtn.querySelector(".material-icons");
	const xIcon = document.getElementById("x-icon");

	// テーマアイコンを更新
	function updateThemeIcon(theme) {
		if (theme === "dark-mode") {
			themeIcon.textContent = "light_mode";
		} else {
			themeIcon.textContent = "dark_mode";
		}
	}

	// Xアイコンを更新
	function updateXIcon(theme) {
		if (xIcon) {
			if (theme === "dark-mode") {
				xIcon.classList.remove("fa-twitter");
				xIcon.classList.add("fa-x-twitter");
			} else {
				xIcon.classList.remove("fa-x-twitter");
				xIcon.classList.add("fa-twitter");
			}
		}
	}

	// 初期テーマ設定
	const savedTheme = localStorage.getItem("theme");
	if (savedTheme) {
		body.classList.add(savedTheme);
		updateThemeIcon(savedTheme);
		updateXIcon(savedTheme);
	} else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
		body.classList.add("dark-mode");
		updateThemeIcon("dark-mode");
		updateXIcon("dark-mode");
	} else {
		body.classList.add("light-mode");
		updateThemeIcon("light-mode");
		updateXIcon("light-mode");
	}

	// ボタンクリックでテーマ切り替え
	themeToggleBtn.addEventListener("click", () => {
		const newTheme = body.classList.contains("dark-mode") ? "light-mode" : "dark-mode";
		const oldTheme = newTheme === "light-mode" ? "dark-mode" : "light-mode";

		body.classList.remove(oldTheme);
		body.classList.add(newTheme);
		localStorage.setItem("theme", newTheme);
		updateThemeIcon(newTheme);
		updateXIcon(newTheme);
	});

	// システム設定の変更を監視（任意）
	window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
		if (!localStorage.getItem("theme")) {
			if (event.matches) {
				body.classList.remove("light-mode");
				body.classList.add("dark-mode");
				updateThemeIcon("dark-mode");
				updateXIcon("dark-mode");
			} else {
				body.classList.remove("dark-mode");
				body.classList.add("light-mode");
				updateThemeIcon("light-mode");
				updateXIcon("light-mode");
			}
		}
	});

	//モーダル処理
	const helpButton = document.getElementById("help-button");
	const helpModal = document.getElementById("help-modal");
	const closeButton = helpModal.querySelector(".close-button");

	helpButton.addEventListener("click", () => {
		helpModal.style.display = "block";
		document.body.style.overflow = "hidden";
	});

	closeButton.addEventListener("click", () => {
		helpModal.style.display = "none";
		document.body.style.overflow = "";
	});

	window.addEventListener("click", (event) => {
		if (event.target === helpModal) {
			helpModal.style.display = "none";
			document.body.style.overflow = "";
		}
	});

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			const openModals = document.querySelectorAll(".modal");
			openModals.forEach((modal) => {
				if (modal.style.display === "block") {
					modal.style.display = "none";
					document.body.style.overflow = "";
				}
			});
		}
	});
});

const STORAGE_KEY_LANG = "harmonia.lang";
const SUPPORTED_LANGS = ["en", "zh-TW", "zh-CN", "ja"];
const translationsCache = new Map();

let currentLang = "en";
let currentTranslations = {};

const detectLanguage = () => {
	const lang = navigator.language || navigator.userLanguage || "en";

	if (lang.startsWith("zh")) {
		if (lang.includes("TW") || lang.includes("Hant")) return "zh-TW";
		if (lang.includes("CN") || lang.includes("Hans")) return "zh-CN";
		return "zh-TW";
	}

	if (lang.startsWith("ja")) return "ja";
	return "en";
};

const getNestedValue = (obj, path) => {
	return path.split(".").reduce((current, key) => current?.[key], obj);
};

const loadTranslations = async (lang) => {
	if (translationsCache.has(lang)) {
		return translationsCache.get(lang);
	}

	try {
		const mod = await import(`./locales/${lang}.json`);
		translationsCache.set(lang, mod.default);
		return mod.default;
	} catch (error) {
		console.error(`[i18n] Failed to load translations for "${lang}":`, error);
		return null;
	}
};

const updateStaticText = () => {
	document.querySelectorAll("[data-i18n]").forEach((el) => {
		const key = el.dataset.i18n;
		const translated = t(key);
		if (translated) {
			el.textContent = translated;
		}
	});

	document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
		const key = el.dataset.i18nPlaceholder;
		const translated = t(key);
		if (translated) {
			el.placeholder = translated;
		}
	});

	document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
		const key = el.dataset.i18nAria;
		const translated = t(key);
		if (translated) {
			el.setAttribute("aria-label", translated);
		}
	});

	document.querySelectorAll("[data-i18n-title]").forEach((el) => {
		const key = el.dataset.i18nTitle;
		const translated = t(key);
		if (translated) {
			el.title = translated;
		}
	});
};

export const t = (key, vars = {}) => {
	let value = getNestedValue(currentTranslations, key);

	if (value === undefined) {
		const enTranslations = translationsCache.get("en");
		if (enTranslations) {
			value = getNestedValue(enTranslations, key);
		}
		if (import.meta?.env?.DEV) {
			console.warn(`[i18n] Missing key: "${key}" in ${currentLang}`);
		}
	}

	if (!value) return key;

	return Object.entries(vars).reduce(
		(result, [k, v]) => result.replace(new RegExp(`{{${k}}}`, "g"), v),
		value,
	);
};

export const setLang = async (lang) => {
	if (!SUPPORTED_LANGS.includes(lang)) {
		console.warn(`[i18n] Unsupported language: "${lang}", falling back to "en"`);
		lang = "en";
	}

	const translations = await loadTranslations(lang);
	if (!translations) return;

	currentLang = lang;
	currentTranslations = translations;

	try {
		localStorage.setItem(STORAGE_KEY_LANG, lang);
	} catch {}

	const htmlLang = lang === "zh-TW" ? "zh-Hant" : lang === "zh-CN" ? "zh-Hans" : lang;
	document.documentElement.lang = htmlLang;

	updateStaticText();
	window.dispatchEvent(new CustomEvent("langChange", { detail: { lang } }));
};

export const getLang = () => currentLang;

export const initI18n = async () => {
	let savedLang = null;
	try {
		savedLang = localStorage.getItem(STORAGE_KEY_LANG);
	} catch {}

	const initialLang = savedLang && SUPPORTED_LANGS.includes(savedLang) ? savedLang : detectLanguage();
	await setLang(initialLang);
};

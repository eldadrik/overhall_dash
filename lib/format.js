export function formatCompactNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);

  if (Number.isNaN(number)) {
    return String(value);
  }

  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(number);
}

export function formatUsd(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1
  }).format(Number(value));
}

export function hasHebrewCharacters(value) {
  return /[\u0590-\u05FF]/.test(value || "");
}

export function normalizeStatusTone(status) {
  if (status === "ok") {
    return "ok";
  }

  if (status === "warning" || status === "partial" || status === "loading") {
    return "warning";
  }

  return "error";
}

export function clampItems(items, size = 5) {
  return items.slice(0, size);
}

export function prioritizeLocaleItems(items, locale) {
  const copy = [...items];

  copy.sort((left, right) => {
    const leftHebrew = hasHebrewCharacters(left.title);
    const rightHebrew = hasHebrewCharacters(right.title);

    if (locale === "he") {
      return Number(rightHebrew) - Number(leftHebrew);
    }

    return Number(leftHebrew) - Number(rightHebrew);
  });

  return copy;
}

export function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

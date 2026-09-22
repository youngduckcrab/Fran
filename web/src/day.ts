import type { Translate, UiLang } from "./i18n";

/**
 * 하루를 가르는 자리를 찾는 데 쓰는 열쇠.
 *
 * 시간을 86400000 으로 나누면 안 된다. 그건 UTC 기준이라, 한국에서 저녁 10시에
 * 한 말과 다음 날 아침에 한 말이 같은 날로 묶인다. 사는 곳의 달력으로 잘라야
 * 사람이 아는 "어제"와 같아진다.
 */
export function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 두 메시지 사이에 날짜가 바뀌었나. 앞의 것이 없으면 거기가 첫 날이다. */
export function startsNewDay(
  timestamp: number,
  previous: number | undefined,
): boolean {
  return previous === undefined || dayKey(timestamp) !== dayKey(previous);
}

/**
 * 구분선에 적을 말. 오늘과 어제는 날짜 대신 말로 적는다.
 * 그 밖은 요일까지 붙인다. "9월 3일"만으로는 무슨 요일이었는지 떠오르지 않는다.
 */
export function formatDay(
  timestamp: number,
  t: Translate,
  lang: UiLang,
): string {
  const key = dayKey(timestamp);
  const now = Date.now();
  if (key === dayKey(now)) return t("day.today");
  if (key === dayKey(now - 86_400_000)) return t("day.yesterday");

  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(lang, {
    ...(sameYear ? {} : { year: "numeric" }),
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

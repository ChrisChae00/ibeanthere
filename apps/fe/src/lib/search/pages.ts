import { getAllDrinks } from '@/data/coffee';

/*
  The pages the header search can open. Kept here rather than read off the router:
  a route is not a destination a reader would type (admin, auth callbacks, the theme
  demo), and each entry needs words the reader might use for it in either language,
  which only a list written by hand carries.

  `label` and `description` are keys in the `search.pages` namespace. `keywords`
  holds both locales on purpose, so a Korean reader browsing the English site still
  finds "지도".
*/
export type PageEntry = {
  id: string;
  path: string;
  keywords: string;
  signedIn?: boolean;
};

export const PAGES: PageEntry[] = [
  { id: 'map', path: '/discover/explore-map', keywords: 'map explore nearby cafes 지도 탐색 근처 카페' },
  { id: 'dropbean', path: '/discover/dropbean', keywords: 'drop bean check in visit 드롭빈 커피콩 심기 방문 체크인' },
  { id: 'register_cafe', path: '/discover/register-cafe', keywords: 'register add new cafe 카페 등록 추가' },
  { id: 'pending', path: '/discover/pending-spots', keywords: 'pending spots verify unverified 대기 검증 인증' },
  { id: 'guide', path: '/learn/coffee', keywords: 'coffee guide learn drinks brewing 커피 가이드 음료 추출' },
  { id: 'my_logs', path: '/my-logs', keywords: 'my logs journal notes history 로그 기록 일지', signedIn: true },
  { id: 'my_beans', path: '/my-beans', keywords: 'my beans growth badges 원두 커피콩 성장 배지', signedIn: true },
  { id: 'profile', path: '/profile', keywords: 'profile account collections 프로필 계정 컬렉션', signedIn: true },
  { id: 'settings', path: '/settings', keywords: 'settings preferences theme language password 설정 테마 언어 비밀번호', signedIn: true },
  { id: 'contact', path: '/contact', keywords: 'contact help feedback support 문의 도움 피드백' },
  { id: 'privacy', path: '/privacy', keywords: 'privacy policy data 개인정보 처리방침' },
  { id: 'terms', path: '/terms', keywords: 'terms of service 이용약관 약관' },
];

const normalize = (s: string) => s.normalize('NFC').toLowerCase().trim();

/**
 * Pages whose label or keywords contain the query. `labelOf` resolves the
 * translated label, which is matched as well so the exact word on the page works.
 */
export function matchPages(
  query: string,
  labelOf: (id: string) => string,
  signedIn: boolean,
): PageEntry[] {
  const q = normalize(query);
  if (!q) return [];
  return PAGES.filter(
    (page) =>
      (signedIn || !page.signedIn) &&
      normalize(`${labelOf(page.id)} ${page.keywords}`).includes(q),
  );
}

export type DrinkEntry = { slug: string; name: string; line: string };

/** Coffee guide articles whose name, other name or slug contains the query, in either locale. */
export function matchDrinks(query: string, locale: 'en' | 'ko'): DrinkEntry[] {
  const q = normalize(query);
  if (!q) return [];
  return getAllDrinks()
    .filter((drink) => {
      const { en, ko } = drink.content;
      return normalize(
        [drink.slug.replace(/-/g, ' '), en.name, en.aka, ko.name, ko.aka].filter(Boolean).join(' '),
      ).includes(q);
    })
    .map((drink) => ({
      slug: drink.slug,
      name: drink.content[locale].name,
      line: drink.content[locale].line,
    }));
}

import type { CoffeeCategory } from './types';

/*
  Three kinds of thing, sorted by what they are rather than when they appeared. The
  guide used to be a timeline of "stages" joined by a line, which told the reader that
  cold brew grew out of espresso and that an Irish coffee came after a flat white.
  Neither is true; dates now live in their own list, where a year is only a year.
*/
export const categories: CoffeeCategory[] = [
  {
    id: 'brewing',
    order: 0,
    cta: 'beans',
    content: {
      en: {
        name: 'Brewing methods',
        definition:
          'Ways of getting coffee out of the grounds. The same beans come out heavier or cleaner depending on which one you use. Click on the list of brewing methods below to see the animation.',
      },
      ko: {
        name: '추출법',
        definition:
          '원두에서 커피를 뽑아내는 방식입니다. 같은 원두도 어떤 방식으로 내리느냐에 따라 무겁게도, 깔끔하게도 나옵니다. 아래 추출법을 누르면 애니메이션을 볼 수 있습니다.',
      },
    },
    drinkSlugs: [
      'pour-over',
      'french-press',
      'aeropress',
      'moka-pot',
      'siphon',
      'turkish-coffee',
      'cold-brew',
    ],
  },
  {
    id: 'espresso',
    order: 1,
    cta: 'cafe',
    content: {
      en: {
        name: 'Espresso and what goes into it',
        definition:
          'One concentrated shot, then water or milk in different amounts. Most of a café menu is a variation on this.',
      },
      ko: {
        name: '에스프레소와 그 변주',
        definition:
          '진한 한 샷에 물이나 우유를 얼마나 더하느냐의 차이입니다. 카페 메뉴 대부분이 여기에 속합니다.',
      },
    },
    drinkSlugs: [
      'espresso',
      'americano',
      'macchiato',
      'cortado',
      'flat-white',
      'cappuccino',
      'cafe-latte',
    ],
  },
  {
    id: 'added',
    order: 2,
    cta: 'cafe',
    content: {
      en: {
        name: 'Coffee with something added',
        definition:
          'Cream, ice cream, whiskey, condensed milk, sugar. Drinks defined by what goes in with the coffee.',
      },
      ko: {
        name: '무언가를 더한 커피',
        definition:
          '크림, 아이스크림, 위스키, 연유, 설탕. 커피와 함께 넣는 재료가 이름이 된 음료들입니다.',
      },
    },
    drinkSlugs: ['einspanner', 'affogato', 'irish-coffee', 'vietnamese-coffee', 'dalgona'],
  },
];

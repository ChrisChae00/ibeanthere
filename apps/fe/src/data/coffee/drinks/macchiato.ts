import type { CoffeeDrink } from '../types';
// test comment 
const macchiato: CoffeeDrink = {
  slug: 'macchiato',
  categoryId: 'espresso',
  reviewed: '2026-09-11',
  related: ['cortado', 'cafe-latte', 'espresso'],
  content: {
    en: {
      name: 'Macchiato',
      aka: 'In Italian: caffè macchiato',
      title: 'Macchiato: what it means, and why a caramel macchiato is a different drink',
      description:
        'A macchiato is an espresso marked with a little milk or foam. What the Italian word means, how it differs from a latte macchiato, and where the caramel macchiato came from.',
      summary:
        'A macchiato, caffè macchiato in Italian, is an espresso with a small amount of milk or milk foam added, just enough to mark it. It is espresso-sized. In many chain cafés, though, a “caramel macchiato” is a large, sweet milk drink, so it helps to know which one a menu means.',
      line: 'Espresso “marked” with a small spot of milk or foam.',
      facts: [
        { label: 'In the cup', value: 'Espresso with a spot of milk or foam' },
        { label: 'Size', value: 'About an espresso' },
        { label: 'Name', value: 'Italian for “stained” or “marked”' },
        { label: 'Not to be confused with', value: 'Latte macchiato, caramel macchiato' },
      ],
      sections: [
        {
          id: 'name',
          heading: 'What does “macchiato” mean?',
          body: [
            {
              text: 'Treccani’s entry for macchiare, to stain, includes adding a small amount of another liquid to a drink to change its taste or colour: macchiare il caffè with a little milk, or macchiare il latte with a little coffee. That gives two drinks. A caffè macchiato is coffee marked with milk; a latte macchiato is milk marked with coffee.',
              sources: ['treccani-macchiare'],
            },
          ],
        },
        {
          id: 'caramel-macchiato',
          heading: 'Why is a caramel macchiato so different?',
          body: [
            {
              text: 'Because it is a different drink. Starbucks introduced the Caramel Macchiato in 1996, developed by Hannah Su and a small team for the company’s 25th anniversary. Sprudge describes it as essentially a vanilla latte topped with caramel, called a macchiato because the espresso is poured over the milk, and notes that people who order “a macchiato” elsewhere can be surprised to receive a three-ounce espresso.',
              sources: ['sprudge-caramel'],
            },
          ],
        },
      ],
    },
    ko: {
      name: '마키아토',
      aka: '이탈리아어로 caffè macchiato',
      title: '마키아토 뜻, 그리고 카라멜 마키아토가 다른 음료인 이유',
      description:
        '마키아토는 에스프레소에 우유나 거품을 조금 얹어 표시한 커피입니다. 이탈리아어의 뜻, 라테 마키아토와의 차이, 카라멜 마키아토가 생긴 경위를 정리했습니다.',
      summary:
        '마키아토, 이탈리아어로 카페 마키아토는 에스프레소에 우유나 우유 거품을 표시가 날 만큼만 조금 더한 커피입니다. 크기는 에스프레소와 비슷합니다. 다만 많은 프랜차이즈 카페에서 ‘카라멜 마키아토’는 크고 단 우유 음료이니, 메뉴가 어느 쪽을 말하는지 알아 두면 좋습니다.',
      line: '에스프레소에 우유나 거품을 조금 얹어 ‘얼룩’을 낸 커피.',
      facts: [
        { label: '재료', value: '에스프레소와 약간의 우유·거품' },
        { label: '크기', value: '에스프레소 정도' },
        { label: '이름', value: '이탈리아어로 ‘얼룩진, 표시된’' },
        { label: '헷갈리기 쉬운 음료', value: '라테 마키아토, 카라멜 마키아토' },
      ],
      sections: [
        {
          id: 'name',
          heading: '‘마키아토’는 무슨 뜻인가',
          body: [
            {
              text: '이탈리아어 사전 트레카니는 ‘얼룩지게 하다’라는 뜻의 macchiare에 음료에 다른 액체를 조금 더해 맛이나 색을 바꾼다는 뜻을 싣고, 커피에 우유를 조금 넣는 것과 우유에 커피를 조금 넣는 것을 예로 듭니다. 그래서 음료도 둘입니다. 카페 마키아토는 우유로 표시한 커피, 라테 마키아토는 커피로 표시한 우유입니다.',
              sources: ['treccani-macchiare'],
            },
          ],
        },
        {
          id: 'caramel-macchiato',
          heading: '카라멜 마키아토는 왜 이렇게 다른가',
          body: [
            {
              text: '다른 음료이기 때문입니다. 스타벅스는 창립 25주년을 맞아 해나 수와 작은 팀이 개발한 카라멜 마키아토를 1996년에 내놓았습니다. 커피 매체 스프러지(Sprudge)는 이를 사실상 카라멜을 얹은 바닐라 라테로 설명하며, 에스프레소를 우유 위에 부어 층이 생기기 때문에 마키아토라는 이름이 붙었다고 적습니다. 다른 카페에서 ‘마키아토’를 시켰다가 작은 에스프레소 한 잔을 받고 놀라는 사람이 있다는 것도요.',
              sources: ['sprudge-caramel'],
            },
          ],
        },
      ],
    },
  },
};

export default macchiato;

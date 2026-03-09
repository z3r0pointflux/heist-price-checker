const STACK_MAX = 8;
const container = document.getElementById('stack-container')!;

container.addEventListener('click', (e) => {
  if (e.target === container) {
    window.heistAPI.dismissOverlay();
  }
});

function formatPriceCard(value: number): string {
  if (value >= 1000) return Math.round(value).toLocaleString();
  if (value >= 10) return value.toFixed(0);
  if (value >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

function buildCard(data: {
  itemInfo: { type: string; displayName: string; baseName?: string };
  price: { minChaos: number; maxChaos: number; variantCount: number; totalListings: number } | null;
  autoDismiss: boolean;
  overlayDismissMs: number;
}): HTMLElement {
  const { itemInfo, price } = data;
  const card = document.createElement('div');
  card.className = 'stack-card';

  const itemNameEl = document.createElement('div');
  itemNameEl.className = `item-name ${itemInfo.type}`;
  itemNameEl.textContent = itemInfo.displayName;
  card.appendChild(itemNameEl);

  const baseNameEl = document.createElement('div');
  baseNameEl.className = 'base-name';
  if (itemInfo.baseName && itemInfo.type !== 'currency') {
    baseNameEl.textContent = itemInfo.type === 'rare'
      ? `Rare Base \u2014 ${itemInfo.baseName}`
      : itemInfo.baseName;
    baseNameEl.style.display = 'block';
  } else {
    baseNameEl.style.display = 'none';
  }
  card.appendChild(baseNameEl);

  const priceSection = document.createElement('div');
  priceSection.className = 'price-section';
  const chaosPriceEl = document.createElement('div');
  chaosPriceEl.className = 'chaos-price';
  const divinePriceEl = document.createElement('div');
  divinePriceEl.className = 'divine-price';
  const listingsEl = document.createElement('div');
  listingsEl.className = 'listings';
  const noPriceEl = document.createElement('div');
  noPriceEl.className = 'no-price';
  noPriceEl.textContent = 'No pricing data found';

  if (price) {
    priceSection.style.display = 'block';
    noPriceEl.style.display = 'none';
    if (price.minChaos === price.maxChaos) {
      chaosPriceEl.textContent = `${formatPriceCard(price.minChaos)} Chaos`;
    } else {
      chaosPriceEl.textContent = `${formatPriceCard(price.minChaos)} - ${formatPriceCard(price.maxChaos)} Chaos`;
    }
    if (price.variantCount > 1) {
      divinePriceEl.textContent = `${price.variantCount} variants on poe.ninja`;
      divinePriceEl.style.display = 'block';
    } else {
      divinePriceEl.style.display = 'none';
    }
    listingsEl.textContent = `~${price.totalListings} listings`;
  } else {
    priceSection.style.display = 'none';
    noPriceEl.style.display = 'block';
  }
  priceSection.appendChild(chaosPriceEl);
  priceSection.appendChild(divinePriceEl);
  priceSection.appendChild(listingsEl);
  card.appendChild(priceSection);

  const attribution = document.createElement('div');
  attribution.className = 'attribution';
  attribution.textContent = 'poe.ninja';
  card.appendChild(attribution);
  card.appendChild(noPriceEl);

  card.addEventListener('click', (e) => {
    e.stopPropagation();
    card.remove();
  });

  if (data.autoDismiss) {
    setTimeout(() => {
      if (card.parentNode) {
        card.remove();
      }
    }, data.overlayDismissMs);
  }

  return card;
}

window.heistAPI.onAppendPriceResult((data: any) => {
  const card = buildCard({
    itemInfo: data.itemInfo,
    price: data.price,
    autoDismiss: data.autoDismiss ?? true,
    overlayDismissMs: data.overlayDismissMs ?? 5000,
  });
  container.insertBefore(card, container.firstChild);

  while (container.children.length > STACK_MAX) {
    container.lastChild!.remove();
  }
});

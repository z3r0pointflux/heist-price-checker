const itemNameEl = document.getElementById('item-name')!;
const baseNameEl = document.getElementById('base-name')!;
const chaosPriceEl = document.getElementById('chaos-price')!;
const divinePriceEl = document.getElementById('divine-price')!;
const listingsEl = document.getElementById('listings')!;
const priceSection = document.getElementById('price-section')!;
const noPriceEl = document.getElementById('no-price')!;

window.heistAPI.onPriceResult((data: any) => {
  const { itemInfo, price } = data;

  // Set item name with color class
  itemNameEl.textContent = itemInfo.displayName;
  itemNameEl.className = itemInfo.type;

  // Set base name
  if (itemInfo.baseName && itemInfo.type !== 'currency') {
    baseNameEl.textContent = itemInfo.type === 'rare'
      ? `Rare Base \u2014 ${itemInfo.baseName}`
      : itemInfo.baseName;
    baseNameEl.style.display = 'block';
  } else {
    baseNameEl.style.display = 'none';
  }

  // Set price info
  if (price) {
    priceSection.style.display = 'block';
    noPriceEl.style.display = 'none';

    // Show price range
    if (price.minChaos === price.maxChaos) {
      chaosPriceEl.textContent = `${formatPrice(price.minChaos)} Chaos`;
    } else {
      chaosPriceEl.textContent = `${formatPrice(price.minChaos)} - ${formatPrice(price.maxChaos)} Chaos`;
    }

    // Show variant count
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
});

function formatPrice(value: number): string {
  if (value >= 1000) return Math.round(value).toLocaleString();
  if (value >= 10) return value.toFixed(0);
  if (value >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

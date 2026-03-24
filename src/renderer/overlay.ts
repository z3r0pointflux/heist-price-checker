const itemNameEl = document.getElementById('item-name')!;
const baseNameEl = document.getElementById('base-name')!;
const chaosPriceEl = document.getElementById('chaos-price')!;
const variantListEl = document.getElementById('variant-list')!;
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

    // If we have labeled variants (ilvl breakdown for base types), show as list
    const labeled = (price.variants || []).filter((v: any) => v.label);
    if (labeled.length > 1) {
      chaosPriceEl.style.display = 'none';
      variantListEl.innerHTML = '';
      // Sort by label (ilvl) ascending
      labeled.sort((a: any, b: any) => {
        const aNum = parseInt(a.label, 10);
        const bNum = parseInt(b.label, 10);
        if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
        return a.label.localeCompare(b.label);
      });
      for (const v of labeled) {
        const row = document.createElement('div');
        row.className = 'variant-row';
        row.textContent = `ilvl ${v.label}: ${formatPrice(v.chaos)}c`;
        variantListEl.appendChild(row);
      }
      variantListEl.style.display = 'block';
    } else {
      // Single price (currency, uniques, single-variant bases)
      chaosPriceEl.textContent = `${formatPrice(price.minChaos)} Chaos`;
      chaosPriceEl.style.display = 'block';
      variantListEl.style.display = 'none';
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

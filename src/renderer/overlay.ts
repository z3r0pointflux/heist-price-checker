const overlayEl = document.getElementById('overlay')!;
const itemNameEl = document.getElementById('item-name')!;
const baseNameEl = document.getElementById('base-name')!;
const chaosPriceEl = document.getElementById('chaos-price')!;
const priceUnitEl = document.getElementById('price-unit')!;
const priceCaptionEl = document.getElementById('price-caption')!;
const variantListEl = document.getElementById('variant-list')!;
const listingsEl = document.getElementById('listings')!;
const priceSection = document.getElementById('price-section')!;
const noPriceEl = document.getElementById('no-price')!;

// The panel's left spine carries the rarity colour so the chrome itself stays
// neutral. Set from the same value that colours the name, not duplicated in CSS.
const SPINE_COLOR: Record<string, string> = {
  unique: 'var(--rarity-unique)',
  rare: 'var(--rarity-rare)',
  currency: 'var(--rarity-currency)',
  unidentified: 'var(--warn)',
};

window.heistAPI.onPriceResult((data: any) => {
  const { itemInfo, price } = data;

  // Set item name with color class. An unidentified item's "name" is only the
  // most name-like OCR line, so label it instead of passing it off as the item.
  if (itemInfo.noTooltip) {
    itemNameEl.textContent = 'No item tooltip found';
    itemNameEl.className = 'unidentified';
  } else if (itemInfo.unidentified) {
    itemNameEl.textContent = "Couldn't identify item";
    itemNameEl.className = 'unidentified';
  } else {
    itemNameEl.textContent = itemInfo.displayName;
    itemNameEl.className = itemInfo.type;
  }

  overlayEl.style.borderLeftColor = SPINE_COLOR[itemNameEl.className] || 'var(--edge-mid)';

  // Set base name
  if (itemInfo.noTooltip) {
    baseNameEl.textContent = 'Hover the item until its tooltip shows, then press again';
    baseNameEl.style.display = 'block';
  } else if (itemInfo.unidentified) {
    baseNameEl.textContent = itemInfo.displayName
      ? `read: "${itemInfo.displayName}" — try re-hovering`
      : 'try re-hovering the item';
    baseNameEl.style.display = 'block';
  } else if (itemInfo.baseName && itemInfo.type !== 'currency') {
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

    // Headline is always the cheapest listing on poe.ninja. The unit lives in
    // the markup so the number can be sized independently of it.
    chaosPriceEl.textContent = formatPrice(price.minChaos);
    priceUnitEl.style.display = 'inline';

    // Say where that number came from, and flag it when it rests on very few
    // listings so a thin outlier isn't mistaken for a reliable price.
    const caption: string[] = ['lowest'];
    if (price.lowestLabel) {
      caption.push(/^\d+$/.test(String(price.lowestLabel)) ? `ilvl ${price.lowestLabel}` : price.lowestLabel);
    }
    if (typeof price.lowestListings === 'number' && price.lowestListings > 0) {
      caption.push(`${price.lowestListings} listing${price.lowestListings === 1 ? '' : 's'}`);
    }
    priceCaptionEl.textContent = caption.join(' · ');
    priceCaptionEl.className =
      typeof price.lowestListings === 'number' && price.lowestListings > 0 && price.lowestListings < 5
        ? 'low-confidence'
        : '';
    priceCaptionEl.style.display = 'block';

    // Keep the per-ilvl breakdown underneath so the spread is still visible.
    const labeled = (price.variants || []).filter((v: any) => v.label);
    if (labeled.length > 1) {
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
        // Base-type labels are item levels; unique labels are variant names.
        // Label and value are separate nodes so the prices align in a column.
        const label = document.createElement('span');
        label.className = 'v-label';
        label.textContent = /^\d+$/.test(String(v.label)) ? `ilvl ${v.label}` : v.label;
        const value = document.createElement('span');
        value.className = 'v-value';
        value.textContent = `${formatPrice(v.chaos)}c`;
        row.append(label, value);
        variantListEl.appendChild(row);
      }
      variantListEl.style.display = 'block';
    } else {
      variantListEl.style.display = 'none';
    }

    // The caption already carries the count behind the headline price. Repeating
    // it here only says something new when the total is larger than that.
    const total = price.totalListings;
    if (typeof total === 'number' && total > 0 && total !== price.lowestListings) {
      listingsEl.textContent = `~${total} listings across all variants`;
      listingsEl.style.display = 'block';
    } else {
      listingsEl.style.display = 'none';
    }
  } else {
    priceSection.style.display = 'none';
    // Only a real lookup miss is a pricing failure. When the tooltip was never
    // found, or the name could not be read, the header already says so and this
    // line just reads as a second, unrelated error.
    const lookupFailed = !itemInfo.noTooltip && !itemInfo.unidentified;
    noPriceEl.style.display = lookupFailed ? 'block' : 'none';
  }
});

function formatPrice(value: number): string {
  if (value >= 1000) return Math.round(value).toLocaleString();
  if (value >= 10) return value.toFixed(0);
  if (value >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

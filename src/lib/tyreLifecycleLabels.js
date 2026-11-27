/**
 * Display labels for the Tyre Lifecycle Tracker (page + its components).
 * Stored status / stage / category tokens stay in English; only the label
 * shown to the user is translated.
 */
export function statusLabels(t) {
  return {
    'Near End': t('tyrelifecycle.status.nearEnd'),
    Normal: t('tyrelifecycle.status.normal'),
    'In Service': t('tyrelifecycle.status.inService'),
    Removed: t('tyrelifecycle.status.removed'),
    'Retread Eligible': t('tyrelifecycle.status.retreadEligible'),
    Retreaded: t('tyrelifecycle.status.retreaded'),
    Scrapped: t('tyrelifecycle.status.scrapped'),
  }
}

export function categoryLabels(t) {
  return {
    New: t('tyrelifecycle.category.new'),
    Retread: t('tyrelifecycle.category.retread'),
    Repaired: t('tyrelifecycle.category.repaired'),
    Scrap: t('tyrelifecycle.category.scrap'),
  }
}

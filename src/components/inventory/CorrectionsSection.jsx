/**
 * Corrections (top-level tab): the master-data correction centre that also
 * lives inside Physical inventory. One implementation, reached from both.
 */
import PhysicalInventoryReview from './PhysicalInventoryReview'

export default function CorrectionsSection({ scope, can, userId }) {
  return <PhysicalInventoryReview view="corrections" scope={scope} can={can} userId={userId} />
}

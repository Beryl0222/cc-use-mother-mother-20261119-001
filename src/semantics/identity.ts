import type { Observation } from '../domain/types.js';

export function groupByIdentity(observations: Observation[]): Map<string, Observation[]> {
  const groups = new Map<string, Observation[]>();
  for (const observation of observations) {
    const current = groups.get(observation.identityKey) ?? [];
    current.push(observation);
    groups.set(observation.identityKey, current);
  }
  return groups;
}

export function distinctValues(observations: Observation[]): Array<number | string> {
  const values = new Map<string, number | string>();
  for (const observation of observations) {
    if (observation.decision === 'rejected') continue;
    const value = observation.candidate.normalizedValue;
    values.set(value, observation.candidate.value);
  }
  return [...values.values()];
}

export function conflicting(observations: Observation[]): boolean {
  return distinctValues(observations).length > 1;
}

export function compareEvidence(left: Observation, right: Observation): number {
  const timeOrder = left.createdAt.localeCompare(right.createdAt);
  if (timeOrder !== 0) return timeOrder;
  return left.id.localeCompare(right.id);
}

export function currentObservations(observations: Observation[]): Observation[] {
  return observations.filter((observation) => observation.decision !== 'rejected');
}

export function observationValueKey(observation: Observation): string {
  return `${observation.identityKey}\u001f${observation.candidate.normalizedValue}`;
}

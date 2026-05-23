/**
 * Three-seat config for the recovery demo. Alice + Bob are Sam's
 * recovery trustees; Sam is the Person who loses his passkey.
 *
 * Each seat is claimed by enrolling a passkey in this app (mode=1
 * Person.PSA deploys with the other two as trustees in Sam's case;
 * Alice + Bob deploy with self-trustee bootstrap, same as
 * demo-web-pro).
 */

export type SeatId = 'alice' | 'bob' | 'sam';

export interface RecoverySeatConfig {
  id: SeatId;
  name: string;
  /** UI tone — describes the seat's role in the recovery story. */
  blurb: string;
}

export const recoverySeats: RecoverySeatConfig[] = [
  {
    id: 'alice',
    name: 'Alice',
    blurb: 'Recovery trustee #1. Signs Sam’s recovery alongside Bob.',
  },
  {
    id: 'bob',
    name: 'Bob',
    blurb: 'Recovery trustee #2. Signs Sam’s recovery alongside Alice.',
  },
  {
    id: 'sam',
    name: 'Sam',
    blurb: 'The Person who loses his passkey and is recovered by Alice + Bob.',
  },
];

export function seatByid(id: SeatId): RecoverySeatConfig {
  const seat = recoverySeats.find((s) => s.id === id);
  if (!seat) throw new Error(`unknown seat ${id}`);
  return seat;
}

export function matchAttacks(times, reference, tolerance) {
  // Maximize one-to-one matches, then minimize summed absolute error.
  const width = reference.length + 1;
  const matches = new Int16Array((times.length + 1) * width);
  const total = new Float64Array(matches.length);
  const choice = new Uint8Array(matches.length);
  for (const [ti, time] of times.entries()) {
    for (const [ri, target] of reference.entries()) {
      const index = (ti + 1) * width + ri + 1;
      const earlier = index - width, previous = index - 1, shared = earlier - 1;
      let best = earlier;
      if (matches[previous] > matches[best] ||
          matches[previous] === matches[best] && total[previous] < total[best]) best = previous;
      matches[index] = matches[best];
      total[index] = total[best];
      choice[index] = Number(best === previous);
      const error = Math.abs(time - target);
      if (error <= tolerance && (matches[shared] >= matches[index] ||
          matches[shared] + 1 === matches[index] && total[shared] + error < total[index])) {
        matches[index] = matches[shared] + 1;
        total[index] = total[shared] + error;
        choice[index] = 2;
      }
    }
  }
  const pairs = [];
  for (let i = times.length, j = reference.length; i && j;) {
    const step = choice[i * width + j];
    if (step === 2) pairs.push([i - 1, j - 1]);
    if (step !== 1) i--;
    if (step !== 0) j--;
  }
  return pairs.reverse();
}

export function compareAttacks(times, reference, tolerance) {
  const pairs = matchAttacks(times, reference, tolerance);
  const signed = pairs.map(([i,j]) => times[i] - reference[j]).sort((a,b) => a-b);
  const errors = signed.map(Math.abs).sort((a,b) => a-b);
  const matched = pairs.length;
  const round = n => Math.round(n*10000)/10000;
  const quantile = (values, q) => values.length ? round(values[Math.ceil(values.length*q)-1]) : null;
  return { detected:times.length, annotated:reference.length, matched,
    unmatchedHeads:times.length-matched, missedReferences:reference.length-matched,
    precision:times.length ? round(matched/times.length) : null,
    recall:reference.length ? round(matched/reference.length) : null,
    f1:times.length+reference.length ? round(2*matched/(times.length+reference.length)) : null,
    signedMedianMs:quantile(signed,.5), medianErrorMs:quantile(errors,.5), p90ErrorMs:quantile(errors,.9),
    p95ErrorMs:quantile(errors,.95), maxErrorMs:quantile(errors,1),
    meanErrorMs:matched ? round(errors.reduce((a,b) => a+b,0)/matched) : null };
}

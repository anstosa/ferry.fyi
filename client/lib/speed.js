import _ from 'lodash';

export const knotsToMph = (knots) => _.round(knots * 1.15078, 2);

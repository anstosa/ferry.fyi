const leaderboardSection =
  /<!-- LEADERBOARDS:START -->[\s\S]*?<!-- LEADERBOARDS:END -->\n?/;
const leaderboardMarkers = /<!-- LEADERBOARDS:(?:START|END) -->\n?/g;

export const filterLeaderboardLlms = (
  content: string,
  enabled: boolean
): string =>
  enabled
    ? content.replace(leaderboardMarkers, "")
    : content.replace(leaderboardSection, "");

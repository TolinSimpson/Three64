# HealthbarComponent (deprecated)

This component has been replaced by the generic statistics system.

Use instead:
- `Statistic` (`runtime/statistic.js`) to own and update the value.
- `StatisticBar` (`runtime/statisticBar.js`) to render a UI bar for a named statistic.

Benefits:
- Works for any bounded scalar (health, stamina, mana, power, gold, etc.).
- Built‑in clamping, min/max, passive regen/drain, and over‑time deltas with easing.
- Clean separation between data (Statistic) and presentation (StatisticBar) via UISystem events.


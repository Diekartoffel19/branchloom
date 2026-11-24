# Branchloom-Zeichen

Das kleine Zeichen verbindet zwei Abzweigungen mit einer senkrechten Linie. Die Geometrie stammt aus der zuvor bereits in der Seitenleiste verwendeten, projektspezifischen `BranchloomMark`-Komponente. Die SVG-Datei `src/renderer/assets/branchloom-mark.svg` ist die wiederverwendbare Vektorquelle für Seitenleiste und Favicon. Die Seitenleiste färbt sie über eine CSS-Maske mit dem jeweiligen Theme-Akzent; das Favicon nutzt festes Immergrün auf transparentem Grund.

`assets/branchloom.ico` enthält dieselbe Liniengeometrie auf einer neutralen Fläche für das Windows-Fenster und das portable Paket. Bei einer Änderung der SVG-Geometrie das Icon mit `python scripts/generate-brand-icon.py` neu erzeugen und beide Darstellungen prüfen. Das Skript benötigt Pillow nur für die Neuerzeugung; Branchloom selbst braucht es nicht.

Diese Originaldateien stehen wie der übrige Repository-Code unter der [MIT-Lizenz](../LICENSE). Es wurden keine externen Logo- oder Bilddateien übernommen.

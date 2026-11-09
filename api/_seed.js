// Prix de départ (copiés de la liste « Prix imbattables »). Ensuite, tout se modifie dans /admin.
const E = "Écran", V = "Vitre arrière", C = "Coque complète";
const rows = [];
const add = (piece, brand, label, quality, price, models) =>
  rows.push({ piece, brand, label, quality: quality || null, price, models: models || null });

// Écrans Samsung
[["A20","Original",18000],["S23","Original",110000],["S23 Ultra","2e qualité",60000],["S24","2e qualité",65000],
 ["S24 Ultra","2e qualité",70000],["S24 Plus","2e qualité",75000],["M11 Lite",null,25000],["A15","Original",35000],
 ["S20 FE",null,45000],["A9",null,25000],["A80",null,45000],["S22 Plus","2e qualité",55000],["A90",null,35000],
 ["M33 5G",null,20000],["J8",null,18000],["J7 Pro","Original",15000]].forEach(([l,q,p]) => add(E,"Samsung",l,q,p));
// Écrans Samsung OLED
[["S8 / S9 / S9+",85000],["S8+",90000],["S10+ / S22 / S23 / S24","OLED 1:1",125000],["S20 / S20 Ultra / S21 / S24+",100000],
 ["S20+ / S23+",90000],["S21+ / S22+",70000],["S21 Ultra / S22 Ultra / S23 Ultra / Note 10 / Note 20",85000],
 ["S24 Ultra / Note 9",110000],["Note 20 Ultra",100000]].forEach((r) =>
  r.length === 3 ? add(E,"Samsung",r[0],r[1],r[2]) : add(E,"Samsung",r[0],"OLED",r[1]));
// Écrans Huawei, Xiaomi, Honor, Vivo, Realme
add(E,"Huawei","Mate 30 Pro","Sans cadre",100000); add(E,"Huawei","Mate 30 Pro","Avec cadre",140000);
add(E,"Huawei","P30 Pro",null,45000); add(E,"Huawei","P30",null,25000); add(E,"Huawei","P40",null,45000); add(E,"Huawei","Nova 10 SE",null,35000);
add(E,"Xiaomi","Poco X6",null,25000); add(E,"Xiaomi","Redmi Note 11","Original",25000);
add(E,"Xiaomi","Redmi 9T / 9 / 9 Lite / X2",null,15000); add(E,"Xiaomi","Redmi 13 Lite",null,25000);
add(E,"Xiaomi","Redmi Note 10 4G","Original",25000);
add(E,"Honor","Honor 50 / 70 / 90 / 9S",null,35000); add(E,"Vivo","V20",null,18000); add(E,"Realme","9 Pro",null,18000);
// Écrans iPhone (standard)
[["iPhone X / XS",7000],["iPhone XR",8000],["iPhone XS Max",10000],["iPhone 11",10000],["iPhone 11 Pro",12000],
 ["iPhone 11 Pro Max",13000],["iPhone 12 / 12 MINI / 12 Pro / 12 Pro Max",15000],["iPhone 13 / 13 MINI",20000],
 ["iPhone 13 Pro",23000],["iPhone 13 Pro Max",25000],["iPhone 14",15000],["iPhone 14 Pro",30000],["iPhone 14 Pro Max",35000],
 ["iPhone 15",30000],["iPhone 15 Pro / 15 Pro Max",40000],["iPhone 16 / 16 Plus",45000],["iPhone 16 Pro",50000],
 ["iPhone 16 Pro Max",55000],["iPhone 17 Pro Max",150000]].forEach(([l,p]) => add(E,"Apple",l,"Standard",p));
// Vitres arrière iPhone
[["iPhone 8G / 8 Plus / X / XS",3000],["iPhone XR / XS Max",5000],["iPhone 11 / 12 / 13 simple",5000],
 ["iPhone 13 Pro / 13 Pro Max",7000],["iPhone 14 Simple / 14 Pro",8000],["iPhone 14 Pro Max",10000],
 ["iPhone 15 Simple / 15 Pro",10000],["iPhone 15 Pro Max / 15 Plus",15000],["iPhone 16 Simple / 16 Pro",18000],
 ["iPhone 16 Pro Max",20000],["iPhone 17 Simple / 17 Pro / 17 Pro Max",20000],["iPhone 17 Air",45000]].forEach(([l,p]) => add(V,"Apple",l,null,p));
// Coques complètes iPhone
[["iPhone X / XS / XR / 11",30000],["iPhone 11 Pro / 11 Pro Max",40000],["iPhone 12 / 12 Pro",42000],["iPhone 12 Pro Max",45000],
 ["iPhone 13",45000],["iPhone 13 Pro / 13 Pro Max",50000],["iPhone 14 / 14 Plus",50000],["iPhone 14 Pro / 14 Pro Max",55000],
 ["iPhone 15 / 15 Plus",55000],["iPhone 15 Pro / 15 Pro Max",65000],["iPhone 16 / 16 Plus",75000],
 ["iPhone 16 Pro / 16 Pro Max",90000]].forEach(([l,p]) => add(C,"Apple",l,null,p));
// Autres écrans Android, par catégorie de prix
add(E,"Autres Android","Catégorie 15 000 F","Standard",15000,
  "Samsung A12, A02, M12, Redmi 9A, Redmi A1, Redmi Note 10 4G, Tecno Infinix Smart 6, Pop 5 Pro, Hot 12i, Huawei Y9 2019, P30 Lite");
add(E,"Autres Android","Catégorie 20 000 F","Standard",20000,
  "Samsung A15, A24, A32 4G, Redmi Note 12 Pro, Redmi Note 11 Pro, Tecno Infinix Hot 60i, Camon 9, Note 8, Huawei P40 Lite, Nova 7");
add(E,"Autres Android","Catégorie 25 000 F","Standard",25000,"Samsung A52");

module.exports = rows;

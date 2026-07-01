/*
  種子資料：由「碧潭商店街 4月瓦斯抄表」原始表格轉檔而來。
  每一列（row）代表原表格中的一個抄表項目，最多可同時擁有 水/電/瓦斯 三種錶。
  group：門市代號（同一門市底下的子項目 group 留空，僅在該門市第一列標示）。
  water / electric / gas 為 null 表示該列沒有此類型的錶。
  meterNo：錶號（含備註文字，如原表格上的「A區公用電:」「總表」等前綴）。
  note：原表格上以紅字/特殊標示的備註，例如「→分錶」「→總表」。
  last：該錶在建立初始期別（INITIAL_PERIOD）時的「上月度數」，null 表示原表格未提供。
  labelColor：對應原表格中門市名稱以藍色/青色字表示的項目，僅作視覺區分，無特殊業務意義。

  提醒：此資料為表格轉檔結果，建議正式使用前於「管理抄表項目」中逐筆核對，
  若發現數字或錶號有誤植，請直接於管理視窗修正即可。
*/

const INITIAL_PERIOD = '2026-04';

const DEFAULT_PRICES = {
  water: 0,
  electric: 0,
  gas: 0
};

const METER_ROWS_SEED = [
  { group: 'A01', name: 'PIZZA',
    water: { last: 4712 },
    electric: { meterNo: '08201732', last: 100339 },
    gas: { meterNo: '007180', last: 1168 } },

  { group: 'A02', name: '泰鄉',
    electric: { meterNo: '08201735', last: 82742 } },
  { group: '', name: '',
    electric: { meterNo: '08202209', last: 90881 } },

  { group: 'A03', name: 'Coffee',
    electric: { meterNo: '08201720', last: 55189 } },

  { group: 'A05', name: '奇迪(A05)',
    water: { last: 52 },
    electric: { meterNo: '08201727', last: 27939 } },

  { group: 'A06', name: '碧水堂-廚',
    water: { last: 7439 },
    electric: { meterNo: '08201736', last: 39600 },
    gas: { meterNo: '007183', last: 3660 } },

  { group: 'A07', name: '碧水堂-吧',
    electric: { meterNo: '08201752', last: 77990 } },
  { group: '', name: '碧水堂-電器',
    electric: { meterNo: '65312139', last: 24812 } },
  { group: '', name: '碧水堂-外場',
    electric: { meterNo: 'A區公用電:08202221', last: 60537 } },
  { group: '', name: '碧水堂-洗',
    water: { last: 7037 },
    electric: { meterNo: 'A區總⑬:23402445', last: 176 } },
  { group: '', name: '碧水堂-冷卻水塔',
    water: { last: 19 } },
  { group: '', name: '前區攤商',
    electric: { meterNo: '18402078', last: 14473 } },

  { group: 'B08', name: '旅客服務中心',
    electric: { meterNo: '08201362', last: 76279 } },

  { group: 'B09', name: '水灣-吧',
    water: { last: 2460 },
    electric: { meterNo: '08201340', last: 86810 },
    gas: { meterNo: '007179', last: 2729 } },
  { group: 'B10', name: '水灣-廚',
    electric: { meterNo: '08201356', last: 12072 } },

  { group: 'B10-2', name: '水灣-B10-12',
    electric: { meterNo: '66310572', last: 95601 } },
  { group: '', name: '水灣-電器',
    electric: { meterNo: '66310560', last: 40184 } },
  { group: '', name: '水灣-外場',
    electric: { meterNo: '24401706', last: 2134 },
    gas: { note: '→分錶' } },
  { group: '', name: '',
    electric: { meterNo: '24401700', last: 1020 },
    gas: { note: '→分錶' } },
  { group: '', name: '水灣-洗',
    water: { last: 6402 },
    electric: { meterNo: '冷氣16401002', last: 10528 } },
  { group: '', name: '水灣-冷卻水塔',
    water: { last: 16 },
    electric: { meterNo: '24402128', note: '(分離冷氣)', last: 4376 } },
  { group: '', name: '',
    electric: { meterNo: '24402126', note: '(水冷冷氣)', last: 3065 } },

  { group: 'B11', name: '堆娃娃樂園',
    electric: { meterNo: '08202231', last: 59030 } },

  { group: 'B12', name: '佳佳娛樂',
    water: { last: 127 },
    electric: { meterNo: '08202235', last: 83339 } },

  { group: 'B13', name: 'B13-吧',
    water: { last: 2909 },
    electric: { meterNo: '08202244', last: 78821 },
    gas: { meterNo: '007182', last: 1965 } },

  { group: 'B15', name: 'B15-廚',
    water: { last: 6423 },
    electric: { meterNo: '08202236', last: 91575 } },
  { group: '', name: 'B15-車後洗區',
    water: { last: 2320 } },

  { group: 'B16', name: 'B16', labelColor: 'blue',
    water: { last: 54 },
    electric: { meterNo: '08201359', last: 66728 } },
  { group: '', name: '超跑',
    electric: { meterNo: '07010558', last: null } },

  { group: 'B17', name: 'B17', labelColor: 'blue',
    water: { last: 2152 },
    electric: { meterNo: '08201371', last: 10034 },
    gas: { meterNo: '007181', last: 474 } },
  { group: '', name: '水水市集', labelColor: 'cyan',
    electric: { meterNo: '62200959', last: 17542 } },
  { group: '', name: 'C區公用電', labelColor: 'cyan',
    electric: { meterNo: '08202292', last: 67015 } },
  { group: '', name: '',
    electric: { meterNo: '08202229', last: 70503, note: '→總表' } },
  { group: '', name: '碧水堂外場-110V',
    electric: { meterNo: '24401696', last: 970 } },
  { group: '', name: '碧水堂外場-220V',
    electric: { meterNo: '24401644', last: 1497 } },
  { group: '', name: '灣潭人力口渡', labelColor: 'cyan',
    electric: { meterNo: '', last: 73617 } },
  { group: '', name: '',
    electric: { meterNo: 'A區總表08201096', last: 115870 } },
  { group: '', name: '',
    electric: { meterNo: 'A區-2總表74721752', last: 29165 } },
  { group: '', name: 'RO水',
    water: { last: 7922 },
    electric: { meterNo: 'B區-1總表08201335', last: 102807 } },
  { group: '', name: '造霧A', labelColor: 'cyan',
    electric: { meterNo: 'B區-2總表66310428', last: 25417 } },
  { group: '', name: '造霧B', labelColor: 'cyan',
    electric: { meterNo: '小木屋06114774', last: 10133 } },
  { group: '', name: '造霧C', labelColor: 'cyan',
    electric: { meterNo: '水舞表65312055', last: 43000 } },
  { group: '', name: 'A區總表',
    water: { last: 2013 },
    electric: { meterNo: '越潭車後-110V 67223857', last: 15216 } },
  { group: '', name: 'B區總表',
    water: { last: 3450 },
    electric: { meterNo: '越潭車後-220V 67310352', last: 25961 } },
  { group: '', name: '',
    electric: { meterNo: 'B+C區總表-10號錶', last: 439 },
    gas: { meterNo: '風管所', last: 138 } },
  { group: '', name: '',
    electric: { meterNo: 'B+C區總表-18號錶', last: 560 },
    gas: { meterNo: '風管所', last: 196 } },
  { group: '', name: '',
    electric: { meterNo: 'B+C區總表-22號錶', last: 93 },
    gas: { meterNo: '風管所', last: 39 } }
];

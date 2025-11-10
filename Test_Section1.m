section Section1;

shared Table1 = let
    Source = Excel.Workbook(File.Contents("C:\Users\jpo64\Downloads\sample_powerquery_data.xlsx"), null, true),
    Table1_Table = Source{[Item="Table1",Kind="Table"]}[Data],
    #"Changed Type" = Table.TransformColumnTypes(Table1_Table,{{"Date", type date}, {"Customer", type text}, {"Region", type text}, {"SalesAmount", Int64.Type}}),
    #"Removed Columns" = Table.RemoveColumns(#"Changed Type",{"Region"})
in
    #"Removed Columns";